// ==================== nexfile.js ====================
// Portado de nexuz_upgraded/savesystem.js — apenas a parte de
// codificação/decodificação do formato .nex (binário proprietário).
// Necessário para Particle Labs: ParticleLab.exportNex() / importNex()
// dependem de window._nexEncodeNex / window._nexDecodeNex.
//
// =========================================================================
//  FORMATO .NEX — Binário proprietário Nexus Engine v2
// =========================================================================
//
//  Offset  Tamanho  Campo
//  ------  -------  -----
//  0       7        Magic: 0x4E 45 58 55 53 33 44  ("NEXUS3D")
//  7       1        Versão do formato: 0x02
//  8       8        Salt aleatório (derivação de chave)
//  16      4        CRC32 do payload obfuscado (uint32 LE)
//  20      4        Comprimento do payload em bytes (uint32 LE)
//  24      N        Payload: JSON comprimido (deflate) + XOR keystream
//
//  O keystream é derivado do salt + segredo de aplicação interno.
// =========================================================================

const _NEX_MAGIC   = [0x4E, 0x45, 0x58, 0x55, 0x53, 0x33, 0x44]; // "NEXUS3D"
const _NEX_VERSION = 0x02;

const _APP_KEY = Uint8Array.from([
    0x6E,0x33,0x78,0x75,0x73,0x5F,0x73,0x63,
    0x33,0x6E,0x65,0x5F,0x73,0x65,0x63,0x72,
    0x65,0x74,0x5F,0x76,0x32,0x21,0x40,0x23,
    0x24,0x25,0x5E,0x26,0x2A,0x28,0x29,0x7E,
]);

// ── CRC32 ─────────────────────────────────────────────────────────────────
const _CRC32_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        t[i] = c;
    }
    return t;
})();

function _crc32(data) {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < data.length; i++)
        crc = _CRC32_TABLE[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

// ── Derivação de keystream (PRNG LCG baseado em salt + _APP_KEY) ──────────
function _deriveKeystream(salt, length) {
    let seed = 0;
    for (let i = 0; i < 8; i++) {
        seed ^= (salt[i] * _APP_KEY[i % _APP_KEY.length]);
        seed  = Math.imul(seed, 0x5851F42D) + 0x14057B7EF767814F;
        seed  = seed >>> 0;
    }
    const ks = new Uint8Array(length);
    for (let i = 0; i < length; i++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        ks[i] = (seed ^ _APP_KEY[i % _APP_KEY.length]) & 0xFF;
    }
    return ks;
}

// ── Compressão / Descompressão (DeflateRaw via streams API) ──────────────
async function _compress(data) {
    if (typeof CompressionStream === 'undefined') return data;
    const cs = new CompressionStream('deflate-raw');
    const writer = cs.writable.getWriter();
    writer.write(data);
    writer.close();
    const chunks = [];
    const reader = cs.readable.getReader();
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
    }
    let total = 0;
    chunks.forEach(c => total += c.length);
    const out = new Uint8Array(total);
    let off = 0;
    chunks.forEach(c => { out.set(c, off); off += c.length; });
    return out;
}

async function _decompress(data) {
    if (typeof DecompressionStream === 'undefined') return data;
    const ds = new DecompressionStream('deflate-raw');
    const writer = ds.writable.getWriter();
    writer.write(data);
    writer.close();
    const chunks = [];
    const reader = ds.readable.getReader();
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
    }
    let total = 0;
    chunks.forEach(c => total += c.length);
    const out = new Uint8Array(total);
    let off = 0;
    chunks.forEach(c => { out.set(c, off); off += c.length; });
    return out;
}

// ── Encoda payload JSON → bytes .nex ─────────────────────────────────────
async function _encodeNex(jsonObj) {
    const jsonStr   = JSON.stringify(jsonObj);
    const jsonBytes = new TextEncoder().encode(jsonStr);

    const compressed = await _compress(jsonBytes);
    const salt = crypto.getRandomValues(new Uint8Array(8));
    const ks   = _deriveKeystream(salt, compressed.length);
    const obfuscated = compressed.map((b, i) => b ^ ks[i]);
    const crc = _crc32(obfuscated);

    const out = new Uint8Array(24 + obfuscated.length);
    let pos = 0;
    _NEX_MAGIC.forEach(b => { out[pos++] = b; });
    out[pos++] = _NEX_VERSION;
    salt.forEach(b => { out[pos++] = b; });
    out[pos++] = (crc)       & 0xFF;
    out[pos++] = (crc >>  8) & 0xFF;
    out[pos++] = (crc >> 16) & 0xFF;
    out[pos++] = (crc >> 24) & 0xFF;
    const len = obfuscated.length;
    out[pos++] = (len)       & 0xFF;
    out[pos++] = (len >>  8) & 0xFF;
    out[pos++] = (len >> 16) & 0xFF;
    out[pos++] = (len >> 24) & 0xFF;
    out.set(obfuscated, pos);
    return out;
}

// ── Decodifica bytes .nex → objeto JSON ──────────────────────────────────
async function _decodeNex(buffer) {
    const data = new Uint8Array(buffer);

    for (let i = 0; i < 7; i++) {
        if (data[i] !== _NEX_MAGIC[i])
            throw new Error('Arquivo inválido: não é um projeto .nex do Nexus Engine.');
    }

    const version = data[7];
    if (version < 0x01 || version > _NEX_VERSION)
        throw new Error(`Versão de projeto .nex não suportada: ${version}`);

    const salt = data.slice(8, 16);
    const crcExpected = data[16] | (data[17] << 8) | (data[18] << 16) | (data[19] << 24);
    const payloadLen  = data[20] | (data[21] << 8) | (data[22] << 16) | (data[23] << 24);

    if (24 + payloadLen > data.length)
        throw new Error('Arquivo .nex corrompido: comprimento inválido.');

    const obfuscated = data.slice(24, 24 + payloadLen);
    const crcActual = _crc32(obfuscated);
    if ((crcActual >>> 0) !== (crcExpected >>> 0))
        throw new Error('Arquivo .nex corrompido: checksum inválido.');

    const ks = _deriveKeystream(salt, obfuscated.length);
    const compressed = obfuscated.map((b, i) => b ^ ks[i]);
    const jsonBytes = await _decompress(compressed);
    const jsonStr = new TextDecoder().decode(jsonBytes);
    return JSON.parse(jsonStr);
}

// ─── Expose globally (mesmo padrão usado pelo particle-engine.js) ────────
window._nexEncodeNex = _encodeNex;
window._nexDecodeNex = _decodeNex;

export { _encodeNex, _decodeNex };
