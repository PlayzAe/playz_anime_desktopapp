import fs from 'node:fs';
import zlib from 'node:zlib';

/*
 * Minimal store-only ZIP writer for .cbz chapters. Images are already
 * compressed, so deflating them again would only cost time. Checksums use
 * zlib's native CRC-32 and the file is written piece by piece, so packing a
 * large chapter never stalls the app.
 */

function crc32(buf: Buffer): number {
  return zlib.crc32(buf) >>> 0;
}

function dosTime(d: Date) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

export interface ZipEntry {
  name: string;
  data: Buffer;
}

export async function writeZip(file: string, entries: ZipEntry[]) {
  const { time, date } = dosTime(new Date());
  const central: Buffer[] = [];
  const tmp = `${file}.part`;
  const fh = await fs.promises.open(tmp, 'w');
  let offset = 0;

  try {
    for (const e of entries) {
      const name = Buffer.from(e.name, 'utf8');
      const crc = crc32(e.data);

      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(20, 4); // version needed
      local.writeUInt16LE(0x0800, 6); // UTF-8 names
      local.writeUInt16LE(0, 8); // stored
      local.writeUInt16LE(time, 10);
      local.writeUInt16LE(date, 12);
      local.writeUInt32LE(crc, 14);
      local.writeUInt32LE(e.data.length, 18);
      local.writeUInt32LE(e.data.length, 22);
      local.writeUInt16LE(name.length, 26);
      local.writeUInt16LE(0, 28);
      await fh.write(Buffer.concat([local, name]));
      await fh.write(e.data);

      const dir = Buffer.alloc(46);
      dir.writeUInt32LE(0x02014b50, 0);
      dir.writeUInt16LE(20, 4); // version made by
      dir.writeUInt16LE(20, 6);
      dir.writeUInt16LE(0x0800, 8);
      dir.writeUInt16LE(0, 10);
      dir.writeUInt16LE(time, 12);
      dir.writeUInt16LE(date, 14);
      dir.writeUInt32LE(crc, 16);
      dir.writeUInt32LE(e.data.length, 20);
      dir.writeUInt32LE(e.data.length, 24);
      dir.writeUInt16LE(name.length, 28);
      dir.writeUInt32LE(offset, 42);
      central.push(dir, name);

      offset += local.length + name.length + e.data.length;
    }

    const centralSize = central.reduce((n, b) => n + b.length, 0);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(centralSize, 12);
    end.writeUInt32LE(offset, 16);
    await fh.write(Buffer.concat([...central, end]));
  } finally {
    await fh.close();
  }
  await fs.promises.rename(tmp, file);
}

const xml = (s: string) => s.replace(/[<>&'"]/g, (c) => `&#${c.charCodeAt(0)};`);

/** ComicInfo.xml lets comic readers (CDisplayEx, Komga, Kavita…) show the series and chapter. */
export function comicInfo(series: string, number: string | null, title: string | null, pages: number): ZipEntry {
  const body = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<ComicInfo xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">',
    `  <Series>${xml(series)}</Series>`,
    number ? `  <Number>${xml(number)}</Number>` : '',
    title ? `  <Title>${xml(title)}</Title>` : '',
    `  <PageCount>${pages}</PageCount>`,
    '  <Manga>YesAndRightToLeft</Manga>',
    '</ComicInfo>',
  ]
    .filter(Boolean)
    .join('\n');
  return { name: 'ComicInfo.xml', data: Buffer.from(body, 'utf8') };
}
