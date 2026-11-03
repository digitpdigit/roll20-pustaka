import { app } from 'electron';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { CreateItemInput, LibraryItem, UpdateItemFields } from './types';

const HASH_RE = /^[0-9a-f]{64}$/;
const EXT_RE = /^\.[A-Za-z0-9]{1,8}$/;

function libraryRoot(): string {
    return path.join(app.getPath('userData'), 'bgm-library');
}

function itemsFile(): string {
    return path.join(libraryRoot(), 'items.json');
}

function audioDir(): string {
    return path.join(libraryRoot(), 'audio');
}

function isEnoent(error: unknown): boolean {
    return error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT';
}

function readItems(): LibraryItem[] {
    let raw: string;
    try {
        raw = fs.readFileSync(itemsFile(), 'utf8');
    } catch (error) {
        if (isEnoent(error)) {
            return [];
        }
        throw error;
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
        throw new Error('items.json is invalid');
    }
    return parsed as LibraryItem[];
}

function writeItems(items: LibraryItem[]): void {
    const root = libraryRoot();
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, 'items.json'), JSON.stringify(items), 'utf8');
}

function extensionFor(originalName: string): string {
    const ext = path.extname(originalName);
    if (EXT_RE.test(ext)) {
        return ext;
    }
    return '.bin';
}

function findAudioFile(fileHash: string): string | null {
    const dir = audioDir();
    let names: string[];
    try {
        names = fs.readdirSync(dir);
    } catch (error) {
        if (isEnoent(error)) {
            return null;
        }
        throw error;
    }
    for (const name of names) {
        if (!name.startsWith(fileHash)) {
            continue;
        }
        const suffix = name.slice(fileHash.length);
        if (suffix === '.bin' || EXT_RE.test(suffix)) {
            return path.join(dir, name);
        }
    }
    return null;
}

export function listItems(): LibraryItem[] {
    return readItems();
}

export function putAudio(bytes: Uint8Array, originalName: string): { fileHash: string } {
    const copy = Uint8Array.from(bytes);
    const fileHash = crypto.createHash('sha256').update(copy).digest('hex');
    const ext = extensionFor(originalName);
    const dir = audioDir();
    fs.mkdirSync(dir, { recursive: true });
    if (findAudioFile(fileHash) === null) {
        fs.writeFileSync(path.join(dir, fileHash + ext), copy);
    }
    return { fileHash };
}

export function readAudio(fileHash: string): Uint8Array {
    if (!HASH_RE.test(fileHash)) {
        throw new Error('Invalid file hash');
    }
    const file = findAudioFile(fileHash);
    if (file === null) {
        throw new Error('Audio file not found');
    }
    return Uint8Array.from(fs.readFileSync(file));
}

export function createItem(input: CreateItemInput): LibraryItem {
    const now = new Date().toISOString();
    const item: LibraryItem = {
        id: crypto.randomUUID(),
        type: input.type,
        name: input.name,
        fileHash: input.fileHash,
        originalName: input.originalName,
        mime: input.mime,
        start: input.start,
        end: input.end,
        speed: input.speed,
        pitchSemitones: input.pitchSemitones,
        pan: input.pan,
        fadeInSec: input.fadeInSec,
        fadeOutSec: input.fadeOutSec,
        createdAt: now,
        updatedAt: now,
    };
    const items = readItems();
    items.push(item);
    writeItems(items);
    return item;
}

export function updateItem(id: string, fields: UpdateItemFields): LibraryItem {
    const items = readItems();
    const index = items.findIndex((item) => item.id === id);
    if (index < 0) {
        throw new Error('Unknown library item');
    }
    const current = items[index];
    const updated: LibraryItem = {
        id: current.id,
        type: current.type,
        fileHash: current.fileHash,
        createdAt: current.createdAt,
        updatedAt: new Date().toISOString(),
        name: fields.name,
        originalName: fields.originalName,
        mime: fields.mime,
        start: fields.start,
        end: fields.end,
        speed: fields.speed,
        pitchSemitones: fields.pitchSemitones,
        pan: fields.pan,
        fadeInSec: fields.fadeInSec,
        fadeOutSec: fields.fadeOutSec,
    };
    items[index] = updated;
    writeItems(items);
    return updated;
}

export function renameItem(id: string, name: string): LibraryItem {
    const items = readItems();
    const index = items.findIndex((item) => item.id === id);
    if (index < 0) {
        throw new Error('Unknown library item');
    }
    const current = items[index];
    const updated: LibraryItem = {
        ...current,
        name,
        updatedAt: new Date().toISOString(),
    };
    items[index] = updated;
    writeItems(items);
    return updated;
}

export function deleteItem(id: string): { ok: true } {
    const items = readItems();
    const index = items.findIndex((item) => item.id === id);
    if (index < 0) {
        throw new Error('Unknown library item');
    }
    const removed = items[index];
    items.splice(index, 1);
    writeItems(items);
    const stillUsed = items.some((item) => item.fileHash === removed.fileHash);
    if (!stillUsed && HASH_RE.test(removed.fileHash)) {
        const file = findAudioFile(removed.fileHash);
        if (file !== null) {
            try {
                fs.unlinkSync(file);
            } catch (error) {
                if (!isEnoent(error)) {
                    throw error;
                }
            }
        }
    }
    return { ok: true };
}
