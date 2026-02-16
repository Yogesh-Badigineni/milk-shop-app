# 🥛 MilkFlow — Smart Milk Shop Management

A complete, modern **Milk Shop Management Application** built with vanilla HTML, CSS, and JavaScript. Track suppliers, stock, sales, and daily operations with a beautiful dark-mode interface.

![MilkFlow](https://img.shields.io/badge/MilkFlow-v1.0-6366f1?style=for-the-badge)
![License](https://img.shields.io/badge/License-MIT-22c55e?style=for-the-badge)
![Platform](https://img.shields.io/badge/Platform-Web-14b8a6?style=for-the-badge)

## ✨ Features

### Core Modules
- **📊 Dashboard** — Real-time overview with stats, quick actions, and activity feed
- **🤝 Supplier Management** — Add/Edit/Delete suppliers with full ledger tracking
- **📦 Stock Entry** — Manual milk purchase recording with auto stock updates
- **🏪 Storage Log** — Internal monitoring of stored milk
- **💰 Sales** — Cash & UPI sales with auto stock reduction and history
- **📋 Day Closing** — Automated end-of-day calculations with record locking
- **💾 Backup** — JSON export/import for data safety
- **⚙️ Settings** — Shop configuration and full user management

### Key Highlights
- 🔐 **Role-based Authentication** (Owner / Staff)
- 👥 **Full User Management** — Change credentials anytime
- 🔒 **Day Lock System** — Owner-only closing prevents unauthorized changes
- 📱 **Fully Responsive** — Works on desktop, tablet, and mobile
- 🌙 **Premium Dark Mode** — Stunning glassmorphism UI
- 📥 **Backup & Restore** — Never lose your data
- 🚀 **No Server Required** — Runs entirely in the browser using localStorage

## 🚀 Quick Start

1. Clone the repository:
   ```bash
   git clone https://github.com/Yogesh-Badigineni/milk-shop-app.git
   ```
2. Open `index.html` in your browser — **that's it!**

### Default Login Credentials
| Role | Username | Password |
|------|----------|----------|
| Owner | `owner` | `owner123` |
| Staff | `staff` | `staff123` |

> 💡 You can change credentials anytime from **Settings → User Management**

## 📂 Project Structure

```
milk-shop-app/
├── index.html          # Main application (all views)
├── css/
│   └── style.css       # Premium design system
├── js/
│   └── app.js          # Complete business logic
├── assets/             # Static assets
└── README.md
```

## 🛠️ Tech Stack

- **HTML5** — Semantic structure
- **CSS3** — Custom properties, gradients, animations, glassmorphism
- **JavaScript (ES6+)** — Modular IIFE pattern, localStorage API
- **Google Fonts** — Inter & JetBrains Mono

## 📋 Daily Operation Flow

```
START DAY → Receive Stock → Update Supplier Ledger → Sales (Cash/UPI) 
→ Auto Stock Update → End Day Closing → Generate Backup → LOCK DAY → END
```

## 🔮 Roadmap (Phase 2)

- [ ] Payment Gateway API integration
- [ ] Webhook for real-time UPI transaction entry
- [ ] Cloud backup integration
- [ ] Mobile APK generation
- [ ] Multi-device sync

## 📄 License

This project is open source and available under the [MIT License](LICENSE).

---

**Built with ❤️ for small dairy businesses**
