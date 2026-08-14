/* A minimal store-only ZIP writer.
 *
 * The image-sequence export produces hundreds of stills, and hundreds of
 * downloads is not an export. They go into one archive instead. Every entry is
 * stored rather than deflated: PNG and JPEG are already compressed, so deflate
 * would spend seconds per frame to save nothing, and store lets each frame be
 * appended as its own Blob part — the browser can spill those to disk, so the
 * archive never has to exist in memory all at once.
 *
 * No ZIP64, so an archive and each file in it must stay under 4 GiB. Anything
 * approaching that has already exhausted the tab. */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) {
    crc = CRC_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/* ZIP keeps timestamps in the MS-DOS packed form: seconds in units of two,
   years counted from 1980. */
function dosStamp(date) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  };
}

export class StoredZip {
  constructor(date = new Date()) {
    this.parts = [];
    this.entries = [];
    this.offset = 0;
    this.stamp = dosStamp(date);
  }

  add(name, bytes) {
    const nameBytes = new TextEncoder().encode(name);
    const crc = crc32(bytes);
    const header = new DataView(new ArrayBuffer(30 + nameBytes.length));
    header.setUint32(0, 0x04034b50, true);
    header.setUint16(4, 20, true);          /* version needed */
    header.setUint16(6, 0x0800, true);      /* UTF-8 file names */
    header.setUint16(8, 0, true);           /* stored */
    header.setUint16(10, this.stamp.time, true);
    header.setUint16(12, this.stamp.date, true);
    header.setUint32(14, crc, true);
    header.setUint32(18, bytes.length, true);
    header.setUint32(22, bytes.length, true);
    header.setUint16(26, nameBytes.length, true);
    header.setUint16(28, 0, true);          /* no extra field */
    new Uint8Array(header.buffer, 30).set(nameBytes);

    this.entries.push({ nameBytes, crc, size: bytes.length, offset: this.offset });
    this.parts.push(header.buffer, bytes);
    this.offset += header.byteLength + bytes.length;
    return this.offset;
  }

  close() {
    const directorySize = this.entries.reduce((total, entry) => total + 46 + entry.nameBytes.length, 0);
    const directory = new DataView(new ArrayBuffer(directorySize + 22));
    let at = 0;
    for (const entry of this.entries) {
      directory.setUint32(at, 0x02014b50, true);
      directory.setUint16(at + 4, 20, true);   /* version made by */
      directory.setUint16(at + 6, 20, true);   /* version needed */
      directory.setUint16(at + 8, 0x0800, true);
      directory.setUint16(at + 10, 0, true);
      directory.setUint16(at + 12, this.stamp.time, true);
      directory.setUint16(at + 14, this.stamp.date, true);
      directory.setUint32(at + 16, entry.crc, true);
      directory.setUint32(at + 20, entry.size, true);
      directory.setUint32(at + 24, entry.size, true);
      directory.setUint16(at + 28, entry.nameBytes.length, true);
      directory.setUint16(at + 30, 0, true);   /* extra */
      directory.setUint16(at + 32, 0, true);   /* comment */
      directory.setUint16(at + 34, 0, true);   /* disk */
      directory.setUint16(at + 36, 0, true);   /* internal attributes */
      directory.setUint32(at + 38, 0, true);   /* external attributes */
      directory.setUint32(at + 42, entry.offset, true);
      new Uint8Array(directory.buffer, at + 46).set(entry.nameBytes);
      at += 46 + entry.nameBytes.length;
    }
    directory.setUint32(at, 0x06054b50, true);
    directory.setUint16(at + 8, this.entries.length, true);
    directory.setUint16(at + 10, this.entries.length, true);
    directory.setUint32(at + 12, directorySize, true);
    directory.setUint32(at + 16, this.offset, true);
    this.parts.push(directory.buffer);
    return new Blob(this.parts, { type: 'application/zip' });
  }
}
