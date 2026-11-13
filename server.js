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
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

function readDB() {
    if (!fs.existsSync(DB_FILE)) {
        const initialData = { users: [], orders: [] };
        fs.writeFileSync(DB_FILE, JSON.stringify(initialData, null, 2));
        return initialData;
    }
    const data = fs.readFileSync(DB_FILE, 'utf-8');
    return JSON.parse(data);
}

function writeDB(data) {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// ==========================================
// 1. مسارات الحسابات والأمان المتقدمة
// ==========================================

// تسجيل حساب جديد حسب الدور
app.post('/api/auth/register', async (req, res) => {
    try {
        const { name, phone, password, role, extraInfo } = req.body;

        if (!name || !phone || !password) {
            return res.status(400).json({ success: false, message: "يرجى ملء جميع الحقول الأساسية." });
        }

        const db = readDB();

        const existingUser = db.users.find(u => u.phone === phone);
        if (existingUser) {
            return res.status(400).json({ success: false, message: "رقم الهاتف هذا مسجل مسبقاً بالفعل!" });
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const assignedRole = role || 'customer';
        
        // الزبون يقبل تلقائياً، بينما المطعم والسائق يحتاجان لموافقة الإدارة
        const isApproved = (assignedRole === 'customer');

        const newUser = {
            id: db.users.length + 1,
            name,
            phone,
            password: hashedPassword,
            role: assignedRole,
            isApproved: isApproved, // حالة تفعيل الحساب
            extraInfo: extraInfo || {}, // معلومات إضافية (مطعم أو سائق)
            createdAt: new Date().toISOString()
        };

        db.users.push(newUser);
        writeDB(db);

        if (!isApproved) {
            return res.status(201).json({
                success: true,
                isPending: true,
                message: "تم تسجيل طلبك بنجاح! حسابك قيد المراجعة من طرف إدارة زادلي، سيتم تفعيله قريباً."
            });
        }

        res.status(201).json({
            success: true,
            isPending: false,
            message: "تم إنشاء حسابك بنجاح!"
        });

    } catch (err) {
        res.status(500).json({ success: false, message: "حدث خطأ: " + err.message });
    }
});

// تسجيل الدخول مع فحص الموافقة
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

        // 🛑 فحص هل الحساب مفعل من الإدارة أم ما زال معلقاً
        if (user.isApproved === false) {
            return res.status(403).json({
                success: false,
                isPending: true,
                message: "عذراً! حسابك لا يزال قيد المراجعة والتحقق من طرف إدارة زادلي ⏳"
            });
        }

        const token = jwt.sign(
            { id: user.id, name: user.name, role: user.role },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.json({
            success: true,
            message: `أهلاً بك يا ${user.name}!`,
            token,
            user: { id: user.id, name: user.name, phone: user.phone, role: user.role }
        });

    } catch (err) {
        res.status(500).json({ success: false, message: "حدث خطأ: " + err.message });
    }
});

// ==========================================
// 2. مسارات لوحة الإدارة (Admin Dashboard)
// ==========================================

// جلب طلبات السائقين والمطاعم المعلقة
app.get('/api/admin/pending-users', (req, res) => {
    const db = readDB();
    const pending = db.users.filter(u => u.isApproved === false);
    res.json({ count: pending.length, pendingUsers: pending });
});

// قبول وتفعيل حساب مستخدم
app.put('/api/admin/approve-user/:id', (req, res) => {
    const userId = parseInt(req.params.id);
    const db = readDB();

    const user = db.users.find(u => u.id === userId);
    if (!user) {
        return res.status(404).json({ success: false, message: "المستخدم غير موجود!" });
    }

    user.isApproved = true;
    writeDB(db);

    res.json({ success: true, message: `تم تفعيل حساب ${user.name} (${user.role}) بنجاح! ✅` });
});

// مسارات الطلبات
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

app.get('/', (req, res) => res.json({ message: "سيرفر زادلي شغال ومطور بنظام إدارة الصلاحيات 🚀" }));

app.listen(PORT, () => {
    console.log(`🚀 السيرفر شغال بنجاح على المنفذ: ${PORT}`);
});