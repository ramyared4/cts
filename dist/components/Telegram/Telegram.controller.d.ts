import { TelegramService } from './Telegram.service';
export declare class TelegramController {
    private readonly telegramService;
    constructor(telegramService: TelegramService);
    connectToTelegram(mobile: string): Promise<import("./TelegramManager").default>;
    connectClient(mobile: string): Promise<string>;
    disconnect(mobile: string): Promise<boolean>;
    disconnectAll(): Promise<string>;
    getMessages(mobile: string, username: string, limit?: number): Promise<import("telegram/Helpers").TotalList<import("telegram").Api.Message>>;
    getChatId(mobile: string, username: string): Promise<any>;
    lastActiveTime(mobile: string): Promise<string>;
    joinChannels(mobile: string, channels: string): Promise<string>;
    removeOtherAuths(mobile: string): Promise<string>;
    getSelfMsgsInfo(mobile: string): Promise<{
        photoCount: number;
        videoCount: number;
        movieCount: number;
        total: number;
    }>;
    getChannelInfo(mobile: string, sendIds?: boolean): Promise<{
        chatsArrayLength: number;
        canSendTrueCount: number;
        canSendFalseCount: number;
        ids: string[];
    }>;
    getAuths(mobile: string): Promise<any>;
    set2Fa(mobile: string): Promise<string>;
    setProfilePic(mobile: string, name: string): Promise<string>;
    updatePrivacy(mobile: string): Promise<string>;
    updateUsername(mobile: string, username: string): Promise<string>;
    newSession(mobile: string): Promise<string>;
    updateName(mobile: string, firstName: string, about: string): Promise<string>;
<<<<<<< HEAD
    getMediaMetadata(mobile: string, chatId: string, offset: number, limit: number): Promise<any[]>;
    downloadMediaFile(mobile: string, messageId: number, chatId: string, res: any): Promise<void>;
    forrward(mobile: string, chatId: string, messageId: number): Promise<void>;
    deleteChat(mobile: string, chatId: string): Promise<void>;
=======
    getMediaMetadata(mobile: string, chatId: string): Promise<any[]>;
    downloadMediaFile(mobile: string, messageId: number, chatId: string, res: any): Promise<void>;
>>>>>>> 57fdcc78618b52695ff08c3d97b6e2a4a14bda30
}
