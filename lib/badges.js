// Lencana verifikasi (seal + centang) per status user.
// Default mengikuti role; owner bisa mengganti lencana siapa pun lewat panel admin
// (kolom users.badge). Warna & label dipakai server (EJS) maupun browser (public/js/app.js).
const BADGES = {
    owner: { key: 'owner', color: '#20E800', label: 'Owner', desc: 'Pendiri / developer' },
    admin: { key: 'admin', color: '#FF1717', label: 'Admin', desc: 'Staff situs' },
    beta: { key: 'beta', color: '#FFD700', label: 'Beta Tester', desc: 'Penguji beta' },
    moderator: { key: 'moderator', color: '#A800FF', label: 'Moderator', desc: 'Penjaga komunitas' },
    user: { key: 'user', color: '#2196F3', label: 'User', desc: 'Anggota terverifikasi' }
}

// Urutan tampil di form admin
const KEYS = ['owner', 'admin', 'moderator', 'beta', 'user']

function isBadge(key) {
    return Object.prototype.hasOwnProperty.call(BADGES, String(key || ''))
}

// Lencana efektif: pilihan owner (users.badge) menang, jika kosong ikut role.
function keyFor(user) {
    if (!user) return null
    const custom = String(user.badge || '').toLowerCase()
    if (isBadge(custom)) return custom
    if (user.role === 'owner') return 'owner'
    if (user.role === 'admin') return 'admin'
    return 'user'
}

function resolve(user) {
    const key = keyFor(user)
    return key ? { ...BADGES[key] } : null
}

module.exports = { BADGES, KEYS, isBadge, keyFor, resolve }
