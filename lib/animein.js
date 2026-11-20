/**
 * Sumber tambahan: AnimeInWeb (animeinweb.com).
 * Menambah server video MP4 langsung (RAPSODI 1080p, 720p, 480p, 360p)
 * di /api/episode/:slug/sources.
 *
 * Alur:
 * 1. Cari judul di /api/proxy/3/2/explore/movie?keyword= (cache 6 jam).
 *    Judul dicocokkan dengan similarity() >= 0.85 (season wajib sama).
 * 2. Ambil daftar episode di /api/proxy/3/2/movie/episode/:id (cache 30 menit).
 * 3. Ambil sumber stream di /api/proxy/3/2/episode/streamnew/:episodeId (cache 15 menit).
 * 4. Filter link direct .mp4 (RAPSODI) dan kembalikan kualitasnya.
 *
 * Domain: ANIMEIN_URL (default https://animeinweb.com)
 * Matikan dengan SOURCE_ANIMEIN=off.
 */
const axios = require('axios')
const cache = require('./cache')

const ENABLED = process.env.SOURCE_ANIMEIN !== 'off'
const BASE_URL = (process.env.ANIMEIN_URL || 'https://animeinweb.com').replace(/\/+$/, '')
const PROXY_SECRET = process.env.ANIMEIN_PROXY_SECRET || 'animein-secure-proxy-key-123'

const client = axios.create({
    baseURL: `${BASE_URL}/api/proxy`,
    timeout: 10000,
    headers: {
        'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        Referer: `${BASE_URL}/`,
        Origin: BASE_URL,
        'x-proxy-secret': PROXY_SECRET,
        Accept: 'application/json, text/plain, */*'
    }
})

let requestCount = 0
let successCount = 0
let failCount = 0

// Cache in-memory proyek ini memakai TTL milidetik & mengembalikan null saat miss.
// Hasil kosong tidak disimpan agar kegagalan sesaat tidak "membeku" 6 jam.
function remember(key, ttlSec, fn) {
    const hit = cache.get(key)
    if (hit !== null) return Promise.resolve(hit)
    return fn().then((value) => {
        const empty = !value || (Array.isArray(value) && !value.length)
        if (!empty) cache.set(key, value, ttlSec * 1000)
        return value
    })
}

async function requestGet(url) {
    requestCount++
    try {
        const res = await client.get(url)
        if (res.data?.status === 200 && res.data?.error === false) {
            successCount++
            return res.data?.data
        }
        failCount++
        return null
    } catch (err) {
        failCount++
        console.warn(`[AnimeIn] Request error ${url}:`, err.message)
        return null
    }
}

/** Kesamaan judul (Dice coefficient pada bigram karakter) — 0..1. */
function similarity(a, b) {
    const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    const x = norm(a)
    const y = norm(b)
    if (!x || !y) return 0
    if (x === y) return 1
    if (x.length < 2 || y.length < 2) return 0
    const grams = (s) => {
        const m = new Map()
        for (let i = 0; i < s.length - 1; i++) {
            const g = s.slice(i, i + 2)
            m.set(g, (m.get(g) || 0) + 1)
        }
        return m
    }
    const ga = grams(x)
    const gb = grams(y)
    let inter = 0
    let total = 0
    ga.forEach((v, k) => { total += v; inter += Math.min(v, gb.get(k) || 0) })
    gb.forEach((v) => { total += v })
    return total ? (2 * inter) / total : 0
}

/** Nomor season dari judul ("Season 2", "S2"); null jika tidak disebut. */
function seasonOf(title) {
    const m = /\b(?:season\s*(\d+)|s(\d+))\b/i.exec(String(title || ''))
    return m ? Number(m[1] || m[2]) : null
}

/** Menghasilkan variasi kata kunci pencarian agar judul dengan tanda baca/kata 'Movie' tetap ditemukan. */
function generateSearchQueries(rawTitle) {
    const queries = new Set()
    const clean = String(rawTitle || '').trim()
    if (!clean) return []

    queries.add(clean)

    const withoutSeasonOrMovie = clean
        .replace(/\s+Season\s+\d+/i, '')
        .replace(/\s+S\d+/i, '')
        .replace(/\b(?:movie|the movie|film|ova|special|bd|batch)\b/gi, '')
        .replace(/\s+/g, ' ')
        .trim()
    if (withoutSeasonOrMovie && withoutSeasonOrMovie !== clean) {
        queries.add(withoutSeasonOrMovie)
    }

    if (/:\s+/.test(clean)) {
        queries.add(clean.replace(/:\s+/g, ':'))
        if (withoutSeasonOrMovie) queries.add(withoutSeasonOrMovie.replace(/:\s+/g, ':'))
    }
    if (/:[^\s]/.test(clean)) {
        queries.add(clean.replace(/:([^\s])/g, ': $1'))
        if (withoutSeasonOrMovie) queries.add(withoutSeasonOrMovie.replace(/:([^\s])/g, ': $1'))
    }

    for (const sep of [':', '-']) {
        if (clean.includes(sep)) {
            const parts = clean.split(sep).map((p) => p.trim()).filter(Boolean)
            for (const p of parts) {
                if (p.length >= 3) {
                    queries.add(p)
                    const pNoMovie = p.replace(/\b(?:movie|the movie)\b/gi, '').trim()
                    if (pNoMovie.length >= 3) queries.add(pNoMovie)
                }
            }
            if (parts.length >= 2) {
                const p0 = parts[0].replace(/\b(?:movie|the movie)\b/gi, '').trim()
                const p1 = parts[1].replace(/\b(?:movie|the movie)\b/gi, '').trim()
                if (p0 && p1) queries.add(`${p0}: ${p1}`)
            }
        }
    }

    return Array.from(queries)
}

/** Pencarian katalog AnimeIn berdasarkan judul. */
function searchAnime(query) {
    const clean = String(query || '').replace(/\s+Season\s+\d+/i, '').trim()
    if (!clean) return Promise.resolve([])
    return remember(`ain_search_${clean.toLowerCase()}`, 6 * 3600, async () => {
        const data = await requestGet(`/3/2/explore/movie?keyword=${encodeURIComponent(clean)}`)
        return (data?.movie || []).map((m) => ({
            id: m.id,
            title: m.title,
            synonyms: m.synonyms || '',
            type: m.type,
            slug: `ain_${m.id}`,
            thumb: m.image_poster || '',
            url: `${BASE_URL}/anime/${m.id}`
        }))
    })
}

/** Daftar episode anime berdasarkan ID dan nomor halaman (30 per halaman). */
function getEpisodes(animeId, page = 0) {
    const id = String(animeId).replace(/^ain_/, '')
    return remember(`ain_eps_${id}_p${page}`, 30 * 60, async () => {
        const data = await requestGet(`/3/2/movie/episode/${encodeURIComponent(id)}?page=${page}`)
        return (data?.episode || []).map((e) => ({
            id: e.id,
            index: Number(e.index) || 0,
            title: e.title
        }))
    })
}

/** Detail Anime dari AnimeIn */
function getAnimeDetail(animeId) {
    const id = String(animeId).replace(/^ain_/, '')
    return remember(`ain_detail_${id}`, 3600, async () => {
        const [detailRes, epRes] = await Promise.all([
            requestGet(`/3/2/movie/detail/${encodeURIComponent(id)}`),
            getEpisodes(id, 0)
        ])
        const m = detailRes?.movie
        if (!m) return null

        const episodes = (epRes || []).map((e) => ({
            title: e.title || `Episode ${e.index}`,
            slug: `ain_${id}_ep_${e.id}`,
            date: m.aired_start || 'Tersedia',
            number: String(e.index || 1),
            url: `${BASE_URL}/watch/${e.id}`
        }))

        return {
            title: m.title,
            japaneseTitle: m.synonyms || m.title,
            slug: `ain_${id}`,
            thumb: m.image_poster || '',
            cover: m.image_cover || '',
            score: '8.5',
            producer: m.studio || 'AnimeIn',
            type: m.type || 'TV',
            status: m.status === 'FINISHED' ? 'Completed' : 'Ongoing',
            totalEpisodes: String(episodes.length || 1),
            duration: m.type === 'MOVIE' ? '100 min' : '24 min',
            releaseDate: m.aired_start || '',
            studio: m.studio || 'AnimeIn',
            genres: m.genre ? m.genre.split(',').map((g) => g.trim()) : ['Anime'],
            synopsis: m.synopsis || '',
            episodes
        }
    })
}

/** Detail stream untuk satu episode AnimeIn. */
function getEpisodeStreams(epId) {
    return remember(`ain_st_${epId}`, 15 * 60, async () => {
        const data = await requestGet(`/3/2/episode/streamnew/${encodeURIComponent(epId)}`)
        return (data?.server || []).map((s) => ({
            name: s.name,
            quality: s.quality,
            link: s.link,
            type: s.type
        }))
    })
}

function normalizeQuality(quality) {
    let q = quality || '720p'
    if (!q.endsWith('p') && /^\d+$/.test(q)) q = `${q}p`
    return q
}

function isPlayable(link, type) {
    if (!link || typeof link !== 'string') return null
    const isDirectMp4 = link.includes('.mp4') || type === 'direct'
    const isHls = link.includes('.m3u8')
    if (!isDirectMp4 && !isHls) return null
    return isHls ? 'hls' : 'mp4'
}

function toSource(s) {
    const kind = isPlayable(s.link, s.type)
    if (!kind) return null
    const quality = normalizeQuality(s.quality)
    return {
        quality,
        server: `${String(s.name || 'rapsodi').toLowerCase()} · animein`,
        url: s.link,
        type: kind,
        lang: 'id'
    }
}

/**
 * Mengambil detail episode mandiri untuk slug format ain_<animeId>_ep_<epId>.
 */
async function getEpisodeDetail(epSlug) {
    const m = String(epSlug).match(/^ain_(\d+)_ep_(\d+)$/)
    if (!m) return null
    const animeId = m[1]
    const epId = m[2]

    const [anime, streams] = await Promise.all([getAnimeDetail(animeId), getEpisodeStreams(epId)])

    const servers = (streams || []).map((s) => {
        const src = toSource(s)
        if (!src) return null
        return {
            name: `RAPSODI (${src.quality})`,
            slug: `ain_server_${s.name}_${src.quality}`,
            content: s.link,
            directUrl: s.link,
            type: src.type,
            quality: src.quality
        }
    }).filter(Boolean)

    const defaultStream = servers.find((s) => s.quality === '1080p')?.directUrl || servers[0]?.directUrl || ''

    return {
        title: anime ? `${anime.title} Episode` : 'Episode',
        animeTitle: anime?.title || 'Anime',
        animeSlug: `ain_${animeId}`,
        streamUrl: defaultStream,
        mirrorStreams: servers,
        qualityList: [
            {
                quality: '1080p',
                serverList: servers.map((s) => ({ title: s.name, content: s.content, directUrl: s.directUrl }))
            }
        ],
        downloads: [],
        hasPrevEpisode: false,
        prevEpisodeSlug: null,
        hasNextEpisode: false,
        nextEpisodeSlug: null
    }
}

/**
 * Mengambil sumber stream langsung untuk slug ain_<animeId>_ep_<epId>.
 */
async function getEpisodeSources(epSlug) {
    const m = String(epSlug).match(/^ain_(\d+)_ep_(\d+)$/)
    if (!m) return []
    const servers = await getEpisodeStreams(m[2])
    return (servers || []).map(toSource).filter(Boolean)
}

function matchEpisode(ep, targetEp) {
    if (!ep) return false
    if (Number(ep.index) === targetEp) return true
    const title = String(ep.title || '').trim().toLowerCase()
    if (title === `episode ${targetEp}` || title === `ep ${targetEp}` || title === `ep. ${targetEp}`) {
        return true
    }
    const m = title.match(/(?:episode|ep\.?)\s*(\d+)/i)
    if (m && Number(m[1]) === targetEp) return true
    return false
}

/**
 * Mencari sumber video AnimeIn untuk satu episode:
 * @param {string} rawTitle Judul seri (mis. "Dandadan", "Tokyo Revengers")
 * @param {number|string} episodeNumber Nomor episode (mis. 1, 6)
 * @returns {Promise<Array<{quality: string, server: string, url: string, type: string, lang: string}>>}
 */
async function sourcesFor(rawTitle, episodeNumber) {
    if (!ENABLED || !rawTitle) return []
    const targetEp = Number(episodeNumber) || 1

    try {
        const queries = generateSearchQueries(rawTitle)
        let candidates = []
        for (const q of queries) {
            const list = await searchAnime(q)
            if (list && list.length > 0) {
                candidates = list
                break
            }
        }

        if (!candidates.length) return []

        const wantedSeason = seasonOf(rawTitle)
        let best = null
        let bestScore = 0
        for (const c of candidates) {
            // Season wajib sama bila judul menyebutkannya di kedua sisi
            const candSeason = seasonOf(c.title)
            if (wantedSeason !== null && candSeason !== null && candSeason !== wantedSeason) continue

            const s1 = similarity(c.title, rawTitle)
            const s2 = c.synonyms ? similarity(c.synonyms, rawTitle) : 0
            const score = Math.max(s1, s2)
            if (score > bestScore) {
                bestScore = score
                best = c
            }
        }

        if (!best || bestScore < 0.85) return []

        let episodes = await getEpisodes(best.id, 0)
        if (!episodes.length) return []

        let match = episodes.find((e) => matchEpisode(e, targetEp))

        if (!match && episodes[0]?.index > targetEp) {
            const estimatedPage = Math.max(1, Math.floor((episodes[0].index - targetEp) / 30))
            const pEpisodes = await getEpisodes(best.id, estimatedPage)
            match = pEpisodes.find((e) => matchEpisode(e, targetEp))
        }

        if (!match && targetEp === 1 && episodes.length === 1) {
            match = episodes[0]
        }

        if (!match) return []

        const servers = await getEpisodeStreams(match.id)
        return (servers || []).map(toSource).filter(Boolean)
    } catch (err) {
        console.warn(`[AnimeIn] sourcesFor failed (${rawTitle} ep ${episodeNumber}):`, err.message)
        return []
    }
}

function isSlug(slug) {
    return typeof slug === 'string' && /^ain_\d+/.test(slug)
}

function stats() {
    return {
        enabled: ENABLED,
        baseUrl: BASE_URL,
        requests: requestCount,
        success: successCount,
        fail: failCount
    }
}

module.exports = {
    enabled: ENABLED,
    isSlug,
    searchAnime,
    getAnimeDetail,
    getEpisodes,
    getEpisodeDetail,
    getEpisodeStreams,
    getEpisodeSources,
    sourcesFor,
    stats
}
