/// <reference types="node" />
import { TelegramService } from './Telegram.service';
import { ForwardMessageDto } from './dto/forward-message.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ChannelOperationDto } from './dto/channel-operation.dto';
import { BulkMessageOperationDto } from './dto/metadata-operations.dto';
import { AddContactsDto } from './dto/contact-operation.dto';
import { MessageSearchDto } from './dto/message-search.dto';
import { MediaFilterDto } from './dto/media-filter.dto';
import { CreateChatFolderDto } from './dto/create-chat-folder.dto';
import { ContactExportImportDto } from './dto/contact-export-import.dto';
import { ContactBlockListDto } from './dto/contact-block-list.dto';
import { Response } from 'express';
import { BackupOptions, ChatStatistics, GroupOptions, MediaAlbumOptions, ScheduleMessageOptions } from '../../interfaces/telegram';
export declare class TelegramController {
    private readonly telegramService;
    constructor(telegramService: TelegramService);
    private handleTelegramOperation;
    connect(mobile: string): Promise<import("./TelegramManager").default>;
    disconnect(mobile: string): Promise<boolean>;
    getMe(mobile: string): Promise<import("telegram").Api.User>;
    updateProfile(mobile: string, updateProfileDto: UpdateProfileDto): Promise<void>;
    setProfilePhoto(mobile: string, name: string): Promise<string>;
    deleteProfilePhotos(mobile: string): Promise<void>;
    getMessages(mobile: string, chatId: string, limit?: number): Promise<import("telegram/Helpers").TotalList<import("telegram").Api.Message>>;
    forwardMessage(forwardMessageDto: ForwardMessageDto): Promise<void>;
    forwardBulkMessages(mobile: string, bulkOp: BulkMessageOperationDto): Promise<void>;
    searchMessages(mobile: string, searchParams: MessageSearchDto): Promise<{
        messages: {
            id: number;
            message: string;
            date: number;
            sender: {
                id: string;
                is_self: boolean;
                username: string;
            };
            media: {
                type: "document" | "video" | "photo";
                thumbnailUrl: string | Buffer;
            };
        }[];
        total: number;
    }>;
    getChannelInfo(mobile: string, includeIds?: boolean): Promise<import("./types/telegram-responses").ChannelInfo>;
    joinChannel(mobile: string, channelOp: ChannelOperationDto): Promise<void | import("telegram").Api.TypeUpdates>;
    leaveChannel(mobile: string, channel: string): Promise<void>;
    setup2FA(mobile: string): Promise<string>;
    updatePrivacy(mobile: string): Promise<string>;
    getActiveSessions(mobile: string): Promise<any[]>;
    terminateOtherSessions(mobile: string): Promise<void>;
    createNewSession(mobile: string): Promise<string>;
    getConnectionStatus(): Promise<{
        status: {
            activeConnections: number;
            rateLimited: number;
            totalOperations: number;
        };
    }>;
    getClientMetadata(mobile: string): Promise<import("./types/client-operations").ClientMetadata>;
    getClientStatistics(): Promise<{
        totalClients: number;
        totalOperations: number;
        failedOperations: number;
        averageReconnects: number;
    }>;
    getHealthStatus(): Promise<{
        connections: {
            activeConnections: number;
            rateLimited: number;
            totalOperations: number;
        };
        statistics: {
            totalClients: number;
            totalOperations: number;
            failedOperations: number;
            averageReconnects: number;
        };
    }>;
    getMediaStats(mobile: string): Promise<{
        photoCount: number;
        videoCount: number;
        movieCount: number;
        total: number;
        ownPhotoCount: number;
        otherPhotoCount: number;
        ownVideoCount: number;
        otherVideoCount: number;
    }>;
    getCallLogStats(mobile: string): Promise<{
        chatCallCounts: any[];
        outgoing: number;
        incoming: number;
        video: number;
        totalCalls: number;
    }>;
    addContactsBulk(contactsDto: AddContactsDto): Promise<void>;
    getMediaInfo(mobile: string): Promise<import("telegram").Api.messages.Messages>;
    sendMedia(mobile: string, chatId: string, url: string, caption: string, filename: string, type: 'photo' | 'file'): Promise<void>;
    downloadMedia(mobile: string, messageId: number, chatId: string, res: Response): Promise<any>;
    getMediaMetadata(mobile: string, chatId: string, offset: number, limit?: number): Promise<import("./types/telegram-responses").MediaMetadata>;
    getFilteredMedia(mobile: string, filterParams: MediaFilterDto): Promise<{
        messages: {
            messageId: number;
            type: "document" | "video" | "photo";
            thumb: any;
            caption: string;
            date: number;
            mediaDetails: {
                filename: string;
                duration: number;
                mimeType: string;
                size: import("big-integer").BigInteger;
            };
        }[];
        total: number;
        hasMore: boolean;
    }>;
    getAllChats(mobile: string): Promise<any[]>;
    getGroupMembers(mobile: string, entityId: string): Promise<any[]>;
    blockChat(mobile: string, chatId: string): Promise<void>;
    deleteChatHistory(mobile: string, chatId: string): Promise<void>;
    sendMessageWithInlineButton(mobile: string, chatId: string, message: string, url: string): Promise<import("telegram").Api.Message>;
    getAllDialogs(mobile: string, limit?: number, archived?: boolean): Promise<{
        id: string;
        title: string;
    }[]>;
    getContacts(mobile: string): Promise<import("telegram").Api.contacts.TypeContacts>;
    getLastActiveTime(mobile: string): Promise<string>;
    disconnectAllClients(): Promise<void>;
    createGroupWithOptions(mobile: string, options: GroupOptions): Promise<import("telegram").Api.Chat | import("telegram").Api.Channel>;
    updateGroupSettings(mobile: string, settings: {
        groupId: string;
        title?: string;
        description?: string;
        slowMode?: number;
        memberRestrictions?: any;
    }): Promise<boolean>;
    scheduleMessage(mobile: string, schedule: ScheduleMessageOptions): Promise<import("telegram").Api.Message>;
    getScheduledMessages(mobile: string, chatId: string): Promise<import("telegram").Api.TypeMessage[]>;
    sendMediaAlbum(mobile: string, album: MediaAlbumOptions): Promise<import("telegram").Api.TypeUpdates>;
    sendVoiceMessage(mobile: string, voice: {
        chatId: string;
        url: string;
        duration?: number;
        caption?: string;
    }): Promise<import("telegram").Api.TypeUpdates>;
    cleanupChat(mobile: string, cleanup: {
        chatId: string;
        beforeDate?: Date;
        onlyMedia?: boolean;
        excludePinned?: boolean;
    }): Promise<{
        deletedCount: number;
    }>;
    getChatStatistics(mobile: string, chatId: string, period?: 'day' | 'week' | 'month'): Promise<ChatStatistics>;
    updatePrivacyBatch(mobile: string, settings: {
        phoneNumber?: 'everybody' | 'contacts' | 'nobody';
        lastSeen?: 'everybody' | 'contacts' | 'nobody';
        profilePhotos?: 'everybody' | 'contacts' | 'nobody';
        forwards?: 'everybody' | 'contacts' | 'nobody';
        calls?: 'everybody' | 'contacts' | 'nobody';
        groups?: 'everybody' | 'contacts' | 'nobody';
    }): Promise<{
        success: boolean;
    }>;
    createBackup(mobile: string, options: {
        chatIds?: string[];
        includeMedia?: boolean;
        exportFormat?: 'json' | 'html';
    }): Promise<import("../../interfaces/telegram").BackupResult>;
    downloadBackup(mobile: string, backupId: string, res: Response): Promise<void>;
    downloadExistingBackup(mobile: string, backupId: string, options: Omit<BackupOptions, 'backupId'>): Promise<{
        messagesCount: number;
        mediaCount: number;
        outputPath: string;
        totalSize: number;
        backupId: string;
    }>;
    getChatBackupStats(mobile: string, chatId: string, period?: 'day' | 'week' | 'month'): Promise<ChatStatistics>;
    listBackups(mobile: string): Promise<{
        backupId: string;
        timestamp: any;
        account: any;
        chats: any;
        totalMessages: any;
    }[]>;
    deleteBackup(mobile: string, backupId: string): Promise<{
        success: boolean;
        message: string;
    }>;
    processBatchMessages(mobile: string, batchOptions: {
        items: any[];
        batchSize: number;
        operation: string;
        delayMs?: number;
    }): Promise<{
        processed: number;
        errors: Error[];
    }>;
    getChatHistory(mobile: string, chatId: string, offset?: number, limit?: number): Promise<any>;
    validateSession(mobile: string): Promise<{
        isValid: boolean;
        isConnected: boolean;
        phoneNumber: string;
    }>;
    addGroupMembers(mobile: string, data: {
        groupId: string;
        members: string[];
    }): Promise<void>;
    removeGroupMembers(mobile: string, data: {
        groupId: string;
        members: string[];
    }): Promise<void>;
    promoteToAdmin(mobile: string, data: {
        groupId: string;
        userId: string;
        permissions?: {
            changeInfo?: boolean;
            postMessages?: boolean;
            editMessages?: boolean;
            deleteMessages?: boolean;
            banUsers?: boolean;
            inviteUsers?: boolean;
            pinMessages?: boolean;
            addAdmins?: boolean;
            anonymous?: boolean;
            manageCall?: boolean;
        };
        rank?: string;
    }): Promise<void>;
    demoteAdmin(mobile: string, data: {
        groupId: string;
        userId: string;
    }): Promise<void>;
    unblockGroupUser(mobile: string, data: {
        groupId: string;
        userId: string;
    }): Promise<void>;
    getGroupAdmins(mobile: string, groupId: string): Promise<{
        userId: string;
        rank?: string;
        permissions: {
            changeInfo: boolean;
            postMessages: boolean;
            editMessages: boolean;
            deleteMessages: boolean;
            banUsers: boolean;
            inviteUsers: boolean;
            pinMessages: boolean;
            addAdmins: boolean;
            anonymous: boolean;
            manageCall: boolean;
        };
    }[]>;
    getGroupBannedUsers(mobile: string, groupId: string): Promise<{
        userId: string;
        bannedRights: {
            viewMessages: boolean;
            sendMessages: boolean;
            sendMedia: boolean;
            sendStickers: boolean;
            sendGifs: boolean;
            sendGames: boolean;
            sendInline: boolean;
            embedLinks: boolean;
            untilDate: number;
        };
    }[]>;
    exportContacts(mobile: string, exportOptions: ContactExportImportDto, res: Response): Promise<void>;
    importContacts(mobile: string, contacts: {
        firstName: string;
        lastName?: string;
        phone: string;
    }[]): Promise<({
        success: boolean;
        phone: string;
        error?: undefined;
    } | {
        success: boolean;
        phone: string;
        error: any;
    })[]>;
    manageBlockList(mobile: string, blockList: ContactBlockListDto): Promise<({
        success: boolean;
        userId: string;
        error?: undefined;
    } | {
        success: boolean;
        userId: string;
        error: any;
    })[]>;
    getContactStatistics(mobile: string): Promise<{
        total: any;
        online: any;
        withPhone: any;
        mutual: any;
        lastWeekActive: any;
    }>;
    createChatFolder(mobile: string, folder: CreateChatFolderDto): Promise<{
        id: number;
        name: string;
        options: {
            includeContacts: boolean;
            includeNonContacts: boolean;
            includeGroups: boolean;
            includeBroadcasts: boolean;
            includeBots: boolean;
            excludeMuted: boolean;
            excludeRead: boolean;
            excludeArchived: boolean;
        };
    }>;
    getChatFolders(mobile: string): Promise<{
        id: any;
        title: any;
        includedChatsCount: any;
        excludedChatsCount: any;
    }[]>;
}
