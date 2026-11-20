const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = "super_secret_food_delivery_app_2026";
const DB_FILE = path.join(__dirname, 'database.json');

app.use(cors());
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ limit: '25mb', extended: true }));

function readDB() {
    if (!fs.existsSync(DB_FILE)) {
        const initialData = { users: [], orders: [], meals: [] };
        fs.writeFileSync(DB_FILE, JSON.stringify(initialData, null, 2));
        return initialData;
    }
    const data = fs.readFileSync(DB_FILE, 'utf-8');
    return JSON.parse(data);
}

function writeDB(data) {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// دالة فحص هل السائق في شهره الأول المجاني (أقل من 30 يوماً)
function isDriverInFreeMonth(driverCreatedAt) {
    if (!driverCreatedAt) return true;
    const regDate = new Date(driverCreatedAt);
    const now = new Date();
    const diffTime = Math.abs(now - regDate);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays <= 30; // true إذا كان في أول 30 يوماً
}

const defaultMeals = [
    {
        "id": 1,
        "name": "برجر لحم كلاسيك فاخر",
        "category": "برجر",
        "price": 750,
        "rating": "4.9 ⭐",
        "time": "20-30 دقيقة ⏱️",
        "desc": "شريحة لحم بقري محلي مع جبنة شيدر ذائبة وصوص زادلي الخاص",
        "image": "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=600",
        "restaurantName": "برجر كينغستار",
        "restaurantPhone": "0550112233"
    },
    {
        "id": 2,
        "name": "بيتزا روما الإيطالية",
        "category": "بيتزا",
        "price": 950,
        "rating": "4.9 ⭐",
        "time": "25-35 دقيقة ⏱️",
        "desc": "عجينة إيطالية هشة ومخمرة مع جبن الموزاريلا الفاخر والريحان",
        "image": "https://images.unsplash.com/photo-1513104890138-7c749659a591?w=600",
        "restaurantName": "بيتزا روما",
        "restaurantPhone": "0550445566"
    },
    {
        "id": 3,
        "name": "تاكوس فرنسي سوبريم",
        "category": "تاكوس",
        "price": 650,
        "rating": "4.8 ⭐",
        "time": "15-20 دقيقة ⏱️",
        "desc": "محشو بالدجاج المتبل والبطاطا المقلية مع صلصة الجبن الغنية",
        "image": "https://images.unsplash.com/photo-1565299585323-38d6b0865b47?w=600",
        "restaurantName": "تاكوس ديزاد",
        "restaurantPhone": "0550778899"
    }
];

// ==========================================
// 1. مسارات الحسابات والأمان
// ==========================================

app.post('/api/auth/register', async (req, res) => {
    try {
        const { name, phone, password, role, extraInfo } = req.body;
        if (!name || !phone || !password) return res.status(400).json({ success: false, message: "بيانات ناقصة!" });

        const db = readDB();
        if (db.users.find(u => u.phone === phone)) return res.status(400).json({ success: false, message: "رقم الهاتف مسجل مسبقاً!" });

        const hashedPassword = await bcrypt.hash(password, 10);
        const assignedRole = role || 'customer';
        const isApproved = (assignedRole === 'customer');

        const newUser = {
            id: db.users.length + 1,
            name,
            phone,
            password: hashedPassword,
            role: assignedRole,
            isApproved: isApproved,
            extraInfo: extraInfo || {},
            createdAt: new Date().toISOString()
        };

        db.users.push(newUser);
        writeDB(db);

        res.status(201).json({
            success: true,
            isPending: !isApproved,
            message: isApproved ? "تم إنشاء الحساب بنجاح!" : "تم تسجيل طلبك وهو قيد مراجعة الإدارة!"
        });
    } catch (err) {
        res.status(500).json({ success: false, message: "خطأ: " + err.message });
    }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { phone, password } = req.body;
        const db = readDB();

        const user = db.users.find(u => u.phone === phone);
        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.status(400).json({ success: false, message: "رقم الهاتف أو كلمة المرور غير صحيحة." });
        }

        if ((user.role === 'restaurant' || user.role === 'driver') && user.isApproved !== true) {
            return res.status(403).json({
                success: false,
                isPending: true,
                message: "عذراً! حسابك لا يزال قيد المراجعة والتحقق من طرف إدارة زادلي ⏳"
            });
        }

        const token = jwt.sign({ id: user.id, name: user.name, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
        
        // التحقق من حالة العرض الترويجي للسائق
        const isPromoActive = user.role === 'driver' ? isDriverInFreeMonth(user.createdAt) : false;

        res.json({
            success: true,
            token,
            user: { 
                id: user.id, 
                name: user.name, 
                phone: user.phone, 
                role: user.role,
                createdAt: user.createdAt,
                isPromoActive: isPromoActive 
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, message: "خطأ: " + err.message });
    }
});

app.post('/api/auth/google-login', async (req, res) => {
    try {
        const { email, name, googleId } = req.body;
        const db = readDB();

        let user = db.users.find(u => u.email === email || (u.extraInfo && u.extraInfo.googleId === googleId));

        if (!user) {
            user = {
                id: db.users.length + 1,
                name: name || "مستخدم Google",
                phone: email,
                email: email,
                password: "google_secured_login",
                role: 'customer',
                isApproved: true,
                extraInfo: { googleId: googleId, authProvider: 'google' },
                createdAt: new Date().toISOString()
            };
            db.users.push(user);
            writeDB(db);
        }

        const token = jwt.sign({ id: user.id, name: user.name, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
        res.json({
            success: true,
            token,
            user: { id: user.id, name: user.name, phone: user.phone, role: user.role }
        });
    } catch (err) {
        res.status(500).json({ success: false, message: "فشل الدخول بـ Google: " + err.message });
    }
});

// ==========================================
// 2. مسارات الإدارة وسقف الديون (Admin API)
// ==========================================

app.get('/api/admin/pending-users', (req, res) => {
    const db = readDB();
    const pending = db.users.filter(u => u.isApproved === false);
    res.json({ count: pending.length, pendingUsers: pending });
});

app.put('/api/admin/approve-user/:id', (req, res) => {
    const userId = parseInt(req.params.id);
    const db = readDB();
    const user = db.users.find(u => u.id === userId);
    if (!user) return res.status(404).json({ success: false, message: "المستخدم غير موجود" });

    user.isApproved = true;
    writeDB(db);
    res.json({ success: true, message: `تم تفعيل حساب ${user.name} بنجاح! ✅` });
});

// مسار تصفير ديون السائق بعد تسديده عبر BaridiMob
app.put('/api/admin/reset-debt/:phone', (req, res) => {
    const phone = req.params.phone;
    const db = readDB();
    const user = db.users.find(u => u.phone === phone);
    if (!user) return res.status(404).json({ success: false, message: "السائق غير موجود" });

    if (!user.wallet) user.wallet = {};
    user.wallet.platformDebt = 0; // تصفير الدين
    user.wallet.isBlocked = false; // فك الحظر
    writeDB(db);

    res.json({ success: true, message: `تم تصفير ديون الكابتن ${user.name} وتفعيل حسابه بنجاح! 💳` });
});

// ==========================================
// 3. مسارات المنيو
// ==========================================

app.get('/api/meals', (req, res) => {
    const db = readDB();
    if (!db.meals || db.meals.length === 0) {
        db.meals = defaultMeals;
        writeDB(db);
    }
    res.json({ meals: db.meals });
});

app.post('/api/meals', (req, res) => {
    try {
        const { name, price, category, desc, image, restaurantName, restaurantPhone } = req.body;
        const db = readDB();
        if (!db.meals) db.meals = defaultMeals;

        const newMeal = {
            id: db.meals.length + 1,
            name,
            price: parseInt(price) || 500,
            category: category || "وجبات سريعة",
            desc: desc || "وجبة طازجة وشهية محضرة بعناية",
            image: image || "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=600",
            rating: "جديد ⭐",
            time: "20-30 دقيقة ⏱️",
            restaurantName: restaurantName || "مطعم شريك",
            restaurantPhone: restaurantPhone || "0550000000"
        };

        db.meals.unshift(newMeal);
        writeDB(db);
        res.status(201).json({ success: true, message: "تمت إضافة الوجبة للمنيو بنجاح!", meal: newMeal });
    } catch (err) {
        res.status(500).json({ success: false, message: "فشل إضافة الوجبة" });
    }
});

// ==========================================
// 4. المحرك المالي والطلبات (15% مطعم - 10% سائق مع الشهر المجاني)
// ==========================================

app.post('/api/orders', (req, res) => {
    const { customerName, phone, mealName, address, totalPrice, restaurantPhone } = req.body;
    const db = readDB();

    const rawMealPrice = parseInt(totalPrice) || 750;
    const deliveryFee = 200; // أجر التوصيل الأساسي
    const totalCashToCollect = rawMealPrice + deliveryFee;

    // 1. حساب حصة المطعم (خصم 15% عمولة المنصة)
    const restaurantCommissionRate = 0.15; // 15%
    const platformFromRestaurant = Math.round(rawMealPrice * restaurantCommissionRate);
    const restaurantNet = rawMealPrice - platformFromRestaurant; // 85% للمطعم

    // كود الاستلام السري
    const pickupCode = Math.floor(1000 + Math.random() * 9000).toString();

    const newOrder = {
        orderId: db.orders.length + 1,
        pickupCode: pickupCode,
        customerName,
        phone,
        mealName,
        address,
        totalPrice: `${totalCashToCollect} د.ج`,
        financials: {
            rawMealPrice: `${rawMealPrice} د.ج`,
            restaurantNet: `${restaurantNet} د.ج`, // صافي المطعم (85%)
            restaurantCommission: `${platformFromRestaurant} د.ج`, // عمولة 15%
            deliveryFee: `${deliveryFee} د.ج`,
            totalCash: `${totalCashToCollect} د.ج`
        },
        restaurantPhone: restaurantPhone || "0550112233",
        assignedDriver: null,
        driverFinancials: null, // يُحسب فور استلام السائق بناءً على تاريخ حسابه
        status: "قيد التحضير في المطبخ 👨‍🍳",
        time: new Date().toLocaleTimeString('ar-DZ')
    };

    db.orders.push(newOrder);
    writeDB(db);

    res.status(201).json({ success: true, message: "تم تسجيل الطلب وحساب النسبة المالية!", order: newOrder });
});

app.get('/api/orders', (req, res) => {
    const db = readDB();
    res.json({ orders: db.orders });
});

// التحقق من كود الاستلام وحساب عمولة السائق (0% في أول شهر أو 10% بعده)
app.put('/api/orders/:id/pickup-verify', (req, res) => {
    const orderId = parseInt(req.params.id);
    const { enteredCode, driverName, driverPhone } = req.body;
    const db = readDB();

    const order = db.orders.find(o => o.orderId === orderId);
    if (!order) return res.status(404).json({ success: false, message: "الطلب غير موجود!" });

    if (order.pickupCode !== enteredCode.toString().trim()) {
        return res.status(400).json({ success: false, message: "❌ كود الاستلام غير صحيح! تأكد من المطعم." });
    }

    // جلب بيانات السائق لفحص هل هو في الشهر الأول المجاني
    const driver = db.users.find(u => u.phone === driverPhone);
    const isFreeMonth = isDriverInFreeMonth(driver ? driver.createdAt : null);

    const deliveryFee = 200;
    // إذا كان في الشهر الأول 0% عمولة، بعد الشهر الأول 10%
    const driverCommission = isFreeMonth ? 0 : Math.round(deliveryFee * 0.10); // 20 د.ج بعد الشهر الأول
    const driverNet = deliveryFee - driverCommission;

    order.status = "المندوب استلم الوجبة وهو في الطريق إليك 🚴‍♂️";
    order.assignedDriver = { name: driverName, phone: driverPhone };
    order.driverFinancials = {
        deliveryFee: `${deliveryFee} د.ج`,
        driverNet: `${driverNet} د.ج`,
        driverCommission: `${driverCommission} د.ج`,
        isFreePromo: isFreeMonth
    };

    writeDB(db);

    res.json({
        success: true,
        message: isFreeMonth 
            ? "✅ تم تأكيد الكود! (عرض الشهر الأول مجاناً: ربحك 100% بدون عمولة للمنصة 🎉)" 
            : "✅ تم تأكيد الكود! (اقتطاع 10% عمولة المنصة)",
        order
    });
});

app.put('/api/orders/:id/status', (req, res) => {
    const orderId = parseInt(req.params.id);
    const { newStatus } = req.body;
    const db = readDB();

    const order = db.orders.find(o => o.orderId === orderId);
    if (!order) return res.status(404).json({ success: false, message: "الطلب غير موجود!" });

    order.status = newStatus;
    writeDB(db);

    res.json({ success: true, order });
});

app.get('/', (req, res) => {
    res.json({ message: "سيرفر زادلي المالي شغال: 15% للمطعم و 10% للسائق مع الشهر الأول المجاني 🚀💰" });
});

app.listen(PORT, () => {
    console.log(`🚀 السيرفر شغال بنجاح على المنفذ: ${PORT}`);
});
