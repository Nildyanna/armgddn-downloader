'use strict';
// Turns 7-Zip's own error text into one plain sentence for the downloads list.
// 7-Zip words a damaged file inside a password-protected archive as "CRC Failed in encrypted file. Wrong password? : data.bin". The archives
// use a fixed built-in password, so a wrong password is not the likely cause: a CRC failure means the data is damaged, so say that.

const DAMAGED_RE = /crc failed|data error|unexpected end of (data|archive)|headers error|checksum error|is not archive|can not open (the )?file as archive|can't open as archive/i;
const WRONG_PW_RE = /wrong password|enter password|password is incorrect|cannot open encrypted archive/i;

// The first file name 7-Zip blames, e.g. "ERROR: CRC Failed in encrypted file. Wrong password? : data.bin" -> "data.bin".
function blamedFile(text) {
  const m = /(?:crc failed|data error)[^\r\n]*? : ([^\r\n]+)/i.exec(String(text || ''));
  return m ? m[1].trim().slice(0, 200) : '';
}

// kind: 'damaged' | 'password' | 'other'
function classify7zFailure(text) {
  const t = String(text || '');
  if (DAMAGED_RE.test(t)) return 'damaged';
  if (WRONG_PW_RE.test(t) || /\bencrypted\b/i.test(t)) return 'password';
  return 'other';
}

function describe7zFailure(text, code) {
  const kind = classify7zFailure(text);
  if (kind === 'damaged') {
    const f = blamedFile(text);
    return `7z extraction failed: ${f ? `${f} is damaged` : 'the archive is damaged or incomplete'} (it failed its own CRC check). The download may not have finished correctly: use Check files, and if a file does not match, download it again.`;
  }
  if (kind === 'password') return '7z extraction failed: wrong password or encrypted archive';
  return null;      // the caller keeps its own generic message
}

module.exports = { classify7zFailure, describe7zFailure, blamedFile };
