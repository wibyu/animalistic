// Penyimpanan lokal Animalistic: Lanjutkan Nonton & Bookmark.
// Semua data disimpan di localStorage browser — tanpa backend/database.
window.WibuStore = (function () {
    var CONTINUE_KEY = 'wibukonContinue'
    var BOOKMARK_KEY = 'wibukonBookmarks'
    var WATCHED_KEY = 'wibukonWatched'
    var MAX_CONTINUE = 12      // maks entri lanjutkan nonton (VIP: 50)
    var MAX_BOOKMARK = 100     // maks entri bookmark (VIP: 500)
    var MAX_WATCHED_ANIME = 100  // maks anime yang riwayat episodenya disimpan (LRU)
    var MAX_WATCHED_EPS = 1500   // maks episode per anime (anime sepanjang One Piece pun muat)

    // Mode VIP: kapasitas penyimpanan lokal dibesarkan (diset lewat setVip)
    var vipMode = false
    function setVip(on) { vipMode = !!on }
    function maxContinue() { return vipMode ? 50 : MAX_CONTINUE }
    function maxBookmark() { return vipMode ? 500 : MAX_BOOKMARK }

    function read(key) {
        try { return JSON.parse(localStorage.getItem(key)) || [] } catch (e) { return [] }
    }

    function write(key, value) {
        try { localStorage.setItem(key, JSON.stringify(value)) } catch (e) {}
    }

    // Escape teks sebelum disisipkan ke HTML — judul dari API bisa mengandung karakter berbahaya
    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
        })
    }

    /* ================= Lanjutkan Nonton ================= */
    // Satu entri per anime: mencatat episode TERJAUH yang pernah dibuka,
    // jadi rewatch episode lama tidak menurunkan progres.

    // Ambil nomor episode dari slug ("10-episode-3" -> 3) atau judul ("Episode 3" -> 3)
    function epsNum(item) {
        var m = /-episode-(\d+)/.exec((item && item.epsSlug) || '')
        if (m) return parseInt(m[1], 10)
        var d = /\d+/.exec((item && item.epsTitle) || '')
        return d ? parseInt(d[0], 10) : 0
    }

    function getContinue() {
        return read(CONTINUE_KEY)
    }

    // item: { animeId, slug, title, img, epsId, epsSlug, epsTitle }
    function saveContinue(item) {
        if (!item || !item.animeId || !item.epsId || !item.slug || !item.epsSlug) return
        var list = read(CONTINUE_KEY)
        var idx = -1
        for (var i = 0; i < list.length; i++) {
            if (String(list[i].animeId) === String(item.animeId)) { idx = i; break }
        }
        if (idx !== -1) {
            var prev = list[idx]
            var prevN = epsNum(prev)
            var newN = epsNum(item)
            list.splice(idx, 1)
            // Episode baru lebih KECIL (rewatch) & nomor keduanya valid:
            // jangan mundurkan progres — simpan yang terjauh, tapi tetap naik ke atas.
            if (newN > 0 && prevN > 0 && newN < prevN) {
                prev.updatedAt = Date.now()
                list.unshift(prev)
                write(CONTINUE_KEY, list.slice(0, maxContinue()))
                return
            }
        }
        item.updatedAt = Date.now()
        list.unshift(item)
        write(CONTINUE_KEY, list.slice(0, maxContinue()))
    }

    function removeContinue(animeId) {
        write(CONTINUE_KEY, read(CONTINUE_KEY).filter(function (x) {
            return String(x.animeId) !== String(animeId)
        }))
    }

    function clearContinue() {
        localStorage.removeItem(CONTINUE_KEY)
    }

    /* ================= Bookmark ================= */
    // item: { animeId, slug, title, img, rating, year, status }

    function getBookmarks() {
        return read(BOOKMARK_KEY)
    }

    function isBookmarked(animeId) {
        return read(BOOKMARK_KEY).some(function (x) {
            return String(x.animeId) === String(animeId)
        })
    }

    function addBookmark(item) {
        if (!item || !item.animeId || !item.slug) return false
        if (isBookmarked(item.animeId)) return true
        var list = read(BOOKMARK_KEY)
        item.addedAt = Date.now()
        list.unshift(item)
        write(BOOKMARK_KEY, list.slice(0, maxBookmark()))
        return true
    }

    function removeBookmark(animeId) {
        write(BOOKMARK_KEY, read(BOOKMARK_KEY).filter(function (x) {
            return String(x.animeId) !== String(animeId)
        }))
    }

    // return true jika setelah toggle jadi tersimpan, false jika jadi terhapus
    function toggleBookmark(item) {
        if (isBookmarked(item.animeId)) {
            removeBookmark(item.animeId)
            return false
        }
        addBookmark(item)
        return true
    }

    function clearBookmarks() {
        localStorage.removeItem(BOOKMARK_KEY)
    }

    /* ================= Episode Sudah Ditonton ================= */
    // Bentuk: { animeId: { e: [epsId...], t: timestampTerakhir } }
    // LRU per anime: anime yang paling lama tak disentuh dibuang duluan.

    function readWatchedObj() {
        try {
            var o = JSON.parse(localStorage.getItem(WATCHED_KEY))
            return (o && typeof o === 'object' && !Array.isArray(o)) ? o : {}
        } catch (e) { return {} }
    }

    function writeWatchedObj(o) {
        try { localStorage.setItem(WATCHED_KEY, JSON.stringify(o)) } catch (e) {}
    }

    function pruneWatched(o) {
        var keys = Object.keys(o)
        if (keys.length <= MAX_WATCHED_ANIME) return o
        keys.sort(function (a, b) { return (o[a].t || 0) - (o[b].t || 0) }) // tertua dulu
        for (var i = 0; i < keys.length - MAX_WATCHED_ANIME; i++) delete o[keys[i]]
        return o
    }

    // Tandai 1 episode sudah ditonton
    function markWatched(animeId, epsId) {
        animeId = String(animeId); epsId = String(epsId)
        if (!animeId || !epsId) return
        var o = readWatchedObj()
        var w = o[animeId] || { e: [], t: 0 }
        if (w.e.indexOf(epsId) === -1) w.e.push(epsId)
        if (w.e.length > MAX_WATCHED_EPS) w.e = w.e.slice(-MAX_WATCHED_EPS)
        w.t = Date.now()
        o[animeId] = w
        writeWatchedObj(pruneWatched(o))
    }

    // Gabungkan daftar dari server ke lokal (sinkron lintas perangkat).
    // Tidak mengubah timestamp LRU — merge bukan aktivitas nonton.
    function mergeWatched(animeId, epsIds) {
        if (!Array.isArray(epsIds) || !epsIds.length) return
        var o = readWatchedObj()
        var key = String(animeId)
        var w = o[key] || { e: [], t: 0 }
        var added = false
        epsIds.forEach(function (id) {
            id = String(id)
            if (w.e.indexOf(id) === -1) { w.e.push(id); added = true }
        })
        if (!added) return
        if (w.e.length > MAX_WATCHED_EPS) w.e = w.e.slice(-MAX_WATCHED_EPS)
        o[key] = w
        writeWatchedObj(pruneWatched(o))
    }

    function getWatched(animeId) {
        var w = readWatchedObj()[String(animeId)]
        return w ? w.e.slice() : []
    }

    function isWatched(animeId, epsId) {
        var w = readWatchedObj()[String(animeId)]
        return w ? w.e.indexOf(String(epsId)) !== -1 : false
    }

    // Ambil daftar "sudah ditonton" dari server (khusus user login), merge ke
    // lokal, lalu panggil cb(daftarEps). Anon/gagal → fallback daftar lokal.
    function syncWatched(animeId, cb) {
        var local = getWatched(animeId)
        if (!window.fetch) { if (cb) cb(local); return }
        fetch('/api/watched/' + encodeURIComponent(String(animeId)))
            .then(function (r) { return r.json() })
            .then(function (d) {
                if (d && d.ok && Array.isArray(d.eps)) {
                    mergeWatched(animeId, d.eps)
                    if (cb) cb(getWatched(animeId))
                } else if (cb) cb(local)
            })
            .catch(function () { if (cb) cb(local) })
    }

    // Kirim tanda "sudah ditonton" ke server (best-effort: anon/gagal diamkan,
    // lokal sudah dicatat lebih dulu oleh markWatched).
    function pushWatched(animeId, epsId) {
        if (!window.fetch) return
        try {
            fetch('/api/watched', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ animeId: String(animeId), epsId: String(epsId) })
            }).catch(function () {})
        } catch (e) {}
    }

    return {
        esc: esc,
        getContinue: getContinue,
        saveContinue: saveContinue,
        removeContinue: removeContinue,
        clearContinue: clearContinue,
        getBookmarks: getBookmarks,
        isBookmarked: isBookmarked,
        addBookmark: addBookmark,
        removeBookmark: removeBookmark,
        toggleBookmark: toggleBookmark,
        clearBookmarks: clearBookmarks,
        markWatched: markWatched,
        mergeWatched: mergeWatched,
        getWatched: getWatched,
        isWatched: isWatched,
        syncWatched: syncWatched,
        pushWatched: pushWatched,
        setVip: setVip
    }
})()

/* ================= Lencana verifikasi ================= */
// Seal + centang; warna mengikuti lencana user (owner/admin/moderator/beta/user).
// Dipakai chat (node dinamis) & halaman level (HTML string).
window.WibuBadge = (function () {
    var MAP = {
        owner: { color: '#20E800', label: 'Owner' },
        admin: { color: '#FF1717', label: 'Admin' },
        beta: { color: '#FFD700', label: 'Beta Tester' },
        moderator: { color: '#A800FF', label: 'Moderator' },
        user: { color: '#2196F3', label: 'User' }
    }
    var SEAL = 'M12.00 0.80L14.28 3.50L17.60 2.30L18.22 5.78L21.70 6.40L20.50 9.72L23.20 12.00L20.50 14.28L21.70 17.60L18.22 18.22L17.60 21.70L14.28 20.50L12.00 23.20L9.72 20.50L6.40 21.70L5.78 18.22L2.30 17.60L3.50 14.28L0.80 12.00L3.50 9.72L2.30 6.40L5.78 5.78L6.40 2.30L9.72 3.50Z'
    var CHECK = 'M7.2 12.3l3 3 6.4-6.6'
    var NS = 'http://www.w3.org/2000/svg'

    function spec(badge) {
        if (!badge) return null
        var key = typeof badge === 'string' ? badge : badge.key
        return MAP[key] ? { key: key, color: MAP[key].color, label: MAP[key].label } : null
    }

    function el(badge, size) {
        var b = spec(badge)
        if (!b || typeof document === 'undefined') return null
        var s = size || 14
        var svg = document.createElementNS(NS, 'svg')
        svg.setAttribute('viewBox', '0 0 24 24')
        svg.setAttribute('width', s)
        svg.setAttribute('height', s)
        svg.setAttribute('class', 'verify-badge shrink-0')
        svg.setAttribute('role', 'img')
        svg.setAttribute('aria-label', b.label + ' terverifikasi')
        var p = document.createElementNS(NS, 'path')
        p.setAttribute('d', SEAL)
        p.setAttribute('fill', b.color)
        var k = document.createElementNS(NS, 'path')
        k.setAttribute('d', CHECK)
        k.setAttribute('fill', 'none')
        k.setAttribute('stroke', '#fff')
        k.setAttribute('stroke-width', '2.4')
        k.setAttribute('stroke-linecap', 'round')
        k.setAttribute('stroke-linejoin', 'round')
        svg.appendChild(p)
        svg.appendChild(k)
        return svg
    }

    function html(badge, size) {
        var b = spec(badge)
        if (!b) return ''
        var s = size || 14
        return '<svg class="verify-badge shrink-0" width="' + s + '" height="' + s + '" viewBox="0 0 24 24" role="img" aria-label="' + b.label + ' terverifikasi"><path d="' + SEAL + '" fill="' + b.color + '"/><path d="' + CHECK + '" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    }

    return { MAP: MAP, spec: spec, el: el, html: html }
})()
