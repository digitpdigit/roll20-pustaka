export type ItemType = 'bgm' | 'soundboard';

export type LibraryItem = {
    id: string;
    type: ItemType;
    name: string;
    fileHash: string;
    originalName: string;
    mime: string;
    start: number;
    end: number;
    speed: number;
    pitchSemitones: number;
    pan: number;
    fadeInSec: number;
    fadeOutSec: number;
    createdAt: string;
    updatedAt: string;
};

export type CreateItemInput = Omit<LibraryItem, 'id' | 'createdAt' | 'updatedAt'>;
export type UpdateItemFields = Omit<
    LibraryItem,
    'id' | 'fileHash' | 'type' | 'createdAt' | 'updatedAt'
>;
