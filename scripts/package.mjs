import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { deflateRawSync } from 'node:zlib';

const root = resolve(import.meta.dirname, '..');
const packagesDir = resolve(root, 'dist', 'packages');
const targets = ['chromium', 'firefox'];

const crcTable = new Uint32Array(256);
for (let index = 0; index < 256; index++) {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  crcTable[index] = value >>> 0;
}

function crc32(data) {
  let value = 0xffffffff;
  for (const byte of data) value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

async function filesIn(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await filesIn(path)));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

function dosDateTime(date) {
  return {
    date: ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
  };
}

function header(signature, fields) {
  const buffer = Buffer.alloc(30);
  buffer.writeUInt32LE(signature, 0);
  fields.forEach((value, index) => buffer.writeUInt16LE(value, 4 + index * 2));
  return buffer;
}

async function createZip(sourceDir, destination) {
  const chunks = [];
  const centralDirectory = [];
  let offset = 0;
  for (const file of (await filesIn(sourceDir)).sort()) {
    const data = await readFile(file);
    const compressed = deflateRawSync(data);
    const body = compressed.length < data.length ? compressed : data;
    const method = body === data ? 0 : 8;
    const { date, time } = dosDateTime((await stat(file)).mtime);
    const name = relative(sourceDir, file).replaceAll('\\', '/');
    const nameBytes = Buffer.from(name);
    const checksum = crc32(data);
    const local = header(0x04034b50, [
      20,
      0x800,
      method,
      time,
      date,
      checksum & 0xffff,
      checksum >>> 16,
      body.length & 0xffff,
      body.length >>> 16,
      data.length & 0xffff,
      data.length >>> 16,
      nameBytes.length,
      0,
    ]);
    chunks.push(local, nameBytes, body);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centralDirectory.push(central, nameBytes);
    offset += local.length + nameBytes.length + body.length;
  }
  const centralSize = centralDirectory.reduce((size, chunk) => size + chunk.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(8, 8);
  end.writeUInt16LE(8, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  await writeFile(destination, Buffer.concat([...chunks, ...centralDirectory, end]));
}

await rm(packagesDir, { recursive: true, force: true });
await mkdir(packagesDir, { recursive: true });
for (const target of targets) {
  await createZip(resolve(root, 'dist', target), resolve(packagesDir, `redeemind-${target}.zip`));
}
