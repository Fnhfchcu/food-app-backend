const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = 5000;
const JWT_SECRET = "super_secret_food_delivery_app_2026";
const DB_FILE = path.join(__dirname, 'database.json');

app.use(cors());
app.use(express.json());

// دالة لقراءة قاعدة البيانات المحلية
function readDB() {
    if (!fs.existsSync(DB_FILE)) {
        const initialData = { users: [], orders: [] };
        fs.writeFileSync(DB_FILE, JSON.stringify(initialData, null, 2));
        return initialData;
    }
    const data = fs.readFileSync(DB_FILE, 'utf-8');
    return JSON.parse(data);
}

// دالة لحفظ البيانات محلياً
function writeDB(data) {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

console.log('✅ قاعدة البيانات المحلية الدائمة جاهزة وتعمل بنجاح!');

// ==========================================
// 1. مسارات الحسابات والأمان (Auth)
// ==========================================

// تسجيل حساب جديد
app.post('/api/auth/register', async (req, res) => {
    try {
        const { name, phone, password, role } = req.body;

        if (!name || !phone || !password) {
            return res.status(400).json({ success: false, message: "يرجى ملء جميع الحقول المطلوبة." });
        }

        const db = readDB();

        // فحص هل الهاتف مسجل مسبقاً
        const existingUser = db.users.find(u => u.phone === phone);
        if (existingUser) {
            return res.status(400).json({ success: false, message: "رقم الهاتف هذا مسجل مسبقاً بالفعل!" });
        }

        // تشفير كلمة المرور
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const newUser = {
            id: db.users.length + 1,
            name,
            phone,
            password: hashedPassword,
            role: role || 'customer',
            createdAt: new Date().toISOString()
        };

        db.users.push(newUser);
        writeDB(db); // حفظ فوري في الملف الدائم

        res.status(201).json({
            success: true,
            message: `تم إنشاء حساب ${role || 'الزبون'} بنجاح! 🎉`
        });

    } catch (err) {
        res.status(500).json({ success: false, message: "حدث خطأ: " + err.message });
    }
});

// تسجيل الدخول
app.post('/api/auth/login', async (req, res) => {
    try {
        const { phone, password } = req.body;
        const db = readDB();

        const user = db.users.find(u => u.phone === phone);
        if (!user) {
            return res.status(400).json({ success: false, message: "رقم الهاتف أو كلمة المرور غير صحيحة." });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ success: false, message: "رقم الهاتف أو كلمة المرور غير صحيحة." });
        }

        // إصدار تصريح الدخول الرقمي
        const token = jwt.sign(
            { id: user.id, name: user.name, role: user.role },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.json({
            success: true,
            message: `أهلاً بك يا ${user.name}! تم تسجيل الدخول بنجاح.`,
            token,
            user: { id: user.id, name: user.name, phone: user.phone, role: user.role }
        });

    } catch (err) {
        res.status(500).json({ success: false, message: "حدث خطأ: " + err.message });
    }
});

// ==========================================
// 2. مسارات الطلبات (Orders)
// ==========================================

app.post('/api/orders', (req, res) => {
    const { customerName, phone, mealName, address, totalPrice } = req.body;
    const db = readDB();

    const newOrder = {
        orderId: db.orders.length + 1,
        customerName,
        phone,
        mealName,
        address,
        totalPrice: totalPrice || "750 د.ج",
        status: "قيد التحضير في المطبخ 👨‍🍳",
        time: new Date().toLocaleTimeString()
    };

    db.orders.push(newOrder);
    writeDB(db);

    res.status(201).json({ success: true, message: "تم تسجيل الطلب وحفظه!", order: newOrder });
});

app.get('/api/orders', (req, res) => {
    const db = readDB();
    res.json({ orders: db.orders });
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

app.get('/', (req, res) => res.json({ message: "سيرفر تطبيق الطعام شغال ومستقل 100% 🚀" }));

app.listen(PORT, () => {
    console.log(`🚀 السيرفر شغال بنجاح على الرابط: http://localhost:${PORT}`);
});