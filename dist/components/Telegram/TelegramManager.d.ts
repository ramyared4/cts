import { TelegramClient } from 'telegram';
import { NewMessageEvent } from 'telegram/events';
import { Api } from 'telegram/tl';
import { TotalList } from 'telegram/Helpers';
import { Dialog } from 'telegram/tl/custom/dialog';
import { IterDialogsParams } from 'telegram/client/dialogs';
declare class TelegramManager {
    private session;
    phoneNumber: string;
    private client;
    private channelArray;
    private static activeClientSetup;
    constructor(sessionString: string, phoneNumber: string);
    static getActiveClientSetup(): {
        days?: number;
        archiveOld: boolean;
        formalities: boolean;
        newMobile: string;
        existingMobile: string;
        clientId: string;
    };
    static setActiveClientSetup(data: {
        days?: number;
        archiveOld: boolean;
        formalities: boolean;
        newMobile: string;
        existingMobile: string;
        clientId: string;
    } | undefined): void;
    disconnect(): Promise<void>;
    getchatId(username: string): Promise<any>;
    getMe(): Promise<Api.User>;
    errorHandler(error: any): Promise<void>;
    createClient(handler?: boolean): Promise<TelegramClient>;
    getMessages(entityLike: Api.TypeEntityLike, limit?: number): Promise<TotalList<Api.Message>>;
    getDialogs(params: IterDialogsParams): Promise<TotalList<Dialog>>;
    getLastMsgs(limit: number): Promise<string>;
    getSelfMSgsInfo(): Promise<{
        photoCount: number;
        videoCount: number;
        movieCount: number;
        total: number;
    }>;
    channelInfo(sendIds?: boolean): Promise<{
        chatsArrayLength: number;
        canSendTrueCount: number;
        canSendFalseCount: number;
        ids: string[];
    }>;
    getEntity(entity: Api.TypeEntityLike): Promise<import("telegram/define").Entity>;
    joinChannel(entity: Api.TypeEntityLike): Promise<Api.TypeUpdates>;
    connected(): boolean;
    connect(): Promise<boolean>;
    removeOtherAuths(): Promise<void>;
    getAuths(): Promise<any>;
    getAllChats(): Promise<any[]>;
    getCallLog(): Promise<{
        chatCallCounts: any[];
        outgoing: number;
        incoming: number;
        video: number;
        totalCalls: number;
    }>;
    handleEvents(event: NewMessageEvent): Promise<void>;
    updatePrivacyforDeletedAccount(): Promise<void>;
    updateProfile(firstName: string, about: string): Promise<void>;
    getLastActiveTime(): Promise<string>;
    getContacts(): Promise<Api.contacts.TypeContacts>;
    getMediaMetadata(): Promise<any[]>;
    downloadMediaFile(messageId: number): Promise<string | Buffer>;
    updateUsername(baseUsername: any): Promise<string>;
    updatePrivacy(): Promise<void>;
    getFileUrl(url: string, filename: string): Promise<string>;
    updateProfilePic(image: any): Promise<void>;
    hasPassword(): Promise<boolean>;
    set2fa(): Promise<void>;
    sendPhotoChat(id: string, url: string, caption: string, filename: string): Promise<void>;
    sendFileChat(id: string, url: string, caption: string, filename: string): Promise<void>;
    deleteProfilePhotos(): Promise<void>;
}
export default TelegramManager;
