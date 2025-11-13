#!/usr/bin/env node

const VERSION = require('./package.json').version;
const express = require('express');
// const util = require('util');

/** @type {number} */
const PORT = process.env.PORT ?? 7000;
const prefix = 'ppv:';
const defaultType = 'PPV';

const app = express();
app.set('trust proxy', true);

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS')
        return res.sendStatus(204);
    next();
});

let streams;
let lastFetchTime = 0;
async function getData() {
    const now = Date.now();
    if (streams && (now - lastFetchTime) < 3600000) return;
    lastFetchTime = now;
    try {
        streams = (await (await fetch('https://ppv.to/api/streams')).json()).streams;
    } catch (error) {
        if (process.env.DEV_LOGGING) console.error('Error in Stream fetching: ' + error);
    }
};

// Stremio Addon Manifest Route
app.get('/manifest.json', async (req, res) => {
    try {
        await getData();
        return res.json({
            id: 'ppvio.vercel.app',
            version: VERSION,
            name: 'PPVio | Vercel',
            description: 'Play PPV live-streams.',
            resources: ['catalog', 'meta'],
            types: [defaultType],
            idPrefixes: [prefix],
            catalogs: [{
                type: defaultType,
                id: prefix + 'PPV',
                name: 'PPV',
                extra: [{
                    name: 'genre',
                    options: streams?.map(x => x.category) ?? []
                }]
            }],
            "stremioAddonsConfig": {
                "issuer": "https://stremio-addons.net",
                "signature": "eyJhbGciOiJkaXIiLCJlbmMiOiJBMTI4Q0JDLUhTMjU2In0..Rz0E6-ZFJIlDkrgajUt2cQ.FgtbqfyoLUiM2muD70GJk6OTQMCrlgL51svfQ_dpnwolOW5zdV6UzP3S6ilA9sTAUZFY8np9br99kfhIyxzhMplU3-tMbW6ry4su_IQto3R8vYV4UtPJER3khm1BYAFw._bUnAtkhN6WSXg_aTvDpSw"
              }
        });
    } catch (error) {
        if (process.env.DEV_LOGGING) console.error('Error in Manifest handler: ' + error);
        return res.json({});
    }
});

// Stremio Addon Catalog Route
app.get('/catalog/:type/:id/:extra?.json', async (req, res) => {
    try {
        if (!req.params.id?.startsWith(prefix)) throw new Error(`Unknown ID in Catalog handler: "${req.params.id}"`);
        const genre = Object.fromEntries(new URLSearchParams(req.params.extra ?? '')).genre;
        await getData();
        return res.json({
            metas: streams?.flatMap(x => ([undefined, x.category].includes(genre) ? x.streams : []).map(y => ({
                id: prefix + y.id,
                type: req.params.type,
                name: y.name,
                poster: y.poster,
                posterShape: 'landscape'
            }))) ?? []
        });
    } catch (error) {
        if (process.env.DEV_LOGGING) console.error('Error in Catalog handler: ' + error);
        return res.json({ metas: [] });
    }
});

// Stremio Addon Meta Route
app.get('/meta/:type/:id.json', async (req, res) => {
    try {
        if (!req.params.id?.startsWith(prefix)) throw new Error(`Unknown ID in Meta handler: "${req.params.id}"`);
        await getData();
        const stream = streams?.flatMap(x => x.streams).find(x => `${prefix}${x.id}` === req.params.id);
        if (!stream) throw new Error(`Unknown ID in Meta handler: "${req.params.id}"`);
        return res.json({
            meta: {
                id: req.params.id,
                type: req.params.type,
                name: stream.name,
                poster: stream.poster,
                posterShape: 'landscape',
                background: stream.poster,
                videos: [{
                    id: req.params.id + ':1:1',
                    title: stream.name,
                    released: new Date(1000 * stream.starts_at).toISOString(),
                    thumbnail: stream.poster,
                    streams: [{
                        url: (await (await fetch(stream.iframe)).text()).match(/https:\/\/.*?\.m3u8/)?.[0],
                        name: stream.uri_name,
                        behaviorHints: {
                            notWebReady: true,
                            proxyHeaders: {
                                request: {
                                    'referer': 'https://ppv.to/'
                                }
                            }
                        }
                    }]
                }],
                behaviorHints: { defaultVideoId: req.params.id + ':1:1' }
            }
        });
    } catch (error) {
        if (process.env.DEV_LOGGING) console.error('Error in Meta handler: ' + error);
        return res.json({ meta: {} });
    }
});

// Error Handling Middleware
app.use((err, req, res, next) => {
    if (process.env.DEV_LOGGING) console.error('Express error:', err);
    res.status(500).json({ error: 'Internal server error', message: err.message });
});

// Start the Server
app.listen(PORT, () => {
    console.log(`Addon server v${VERSION} running on port ${PORT}`);
    console.log(`Access the configuration page at: ${process.env.SPACE_HOST ? 'https://' + process.env.SPACE_HOST : 'http://localhost:' + PORT}`);
});
