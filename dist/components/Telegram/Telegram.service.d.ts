import { BufferClientService } from './../buffer-clients/buffer-client.service';
import { UsersService } from '../users/users.service';
import TelegramManager from "./TelegramManager";
import { OnModuleDestroy } from '@nestjs/common';
import { Api } from 'telegram';
import { ActiveChannelsService } from '../active-channels/active-channels.service';
import { ChannelsService } from '../channels/channels.service';
import { Channel } from '../channels/schemas/channel.schema';
import { EntityLike } from 'telegram/define';
export declare class TelegramService implements OnModuleDestroy {
    private usersService;
    private bufferClientService;
    private activeChannelsService;
    private channelsService;
    private static clientsMap;
    constructor(usersService: UsersService, bufferClientService: BufferClientService, activeChannelsService: ActiveChannelsService, channelsService: ChannelsService);
    onModuleDestroy(): Promise<void>;
    getActiveClientSetup(): {
        days?: number;
        archiveOld: boolean;
        formalities: boolean;
        newMobile: string;
        existingMobile: string;
        clientId: string;
    };
    setActiveClientSetup(data: {
        days?: number;
        archiveOld: boolean;
        formalities: boolean;
        newMobile: string;
        existingMobile: string;
        clientId: string;
    } | undefined): void;
    getClient(number: string): Promise<TelegramManager>;
    hasClient(number: string): boolean;
    deleteClient(number: string): Promise<boolean>;
    disconnectAll(): Promise<void>;
    createClient(mobile: string, autoDisconnect?: boolean, handler?: boolean): Promise<TelegramManager>;
    getMessages(mobile: string, username: string, limit?: number): Promise<import("telegram/Helpers").TotalList<Api.Message>>;
    getMessagesNew(mobile: string, username: string, offset: number, limit: number): Promise<any>;
    sendInlineMessage(mobile: string, chatId: string, message: string, url: string): Promise<Api.Message>;
    getChatId(mobile: string, username: string): Promise<any>;
    getLastActiveTime(mobile: string): Promise<string>;
    tryJoiningChannel(mobile: string, chatEntity: Channel): Promise<void>;
    removeChannels(error: any, channelId: string, username: string): Promise<void>;
    getGrpMembers(mobile: string, entity: EntityLike): Promise<any[]>;
    addContact(mobile: string, data: {
        mobile: string;
        tgId: string;
    }[], prefix: string): Promise<void>;
    addContacts(mobile: string, phoneNumbers: string[], prefix: string): Promise<void>;
    removeOtherAuths(mobile: string): Promise<string>;
    getSelfMsgsInfo(mobile: string): Promise<{
        photoCount: number;
        videoCount: number;
        movieCount: number;
        total: number;
        ownPhotoCount: number;
        otherPhotoCount: number;
        ownVideoCount: number;
        otherVideoCount: number;
    }>;
    createGroup(mobile: string): Promise<{
        id: any;
        accessHash: any;
    }>;
    forwardSecrets(mobile: string, fromChatId: string): Promise<void>;
    joinChannelAndForward(mobile: string, fromChatId: string, channel: string): Promise<void>;
    getCallLog(mobile: string): Promise<{
        chatCallCounts: any[];
        outgoing: number;
        incoming: number;
        video: number;
        totalCalls: number;
    }>;
    getmedia(mobile: string): Promise<Api.messages.Messages>;
    getChannelInfo(mobile: string, sendIds?: boolean): Promise<{
        chatsArrayLength: number;
        canSendTrueCount: number;
        canSendFalseCount: number;
        ids: string[];
        canSendFalseChats: string[];
    }>;
    getAuths(mobile: string): Promise<any>;
    getMe(mobile: string): Promise<Api.User>;
    createNewSession(mobile: string): Promise<string>;
    set2Fa(mobile: string): Promise<string>;
    updatePrivacyforDeletedAccount(mobile: string): Promise<void>;
    deleteProfilePhotos(mobile: string): Promise<void>;
    setProfilePic(mobile: string, name: string): Promise<string>;
    updatePrivacy(mobile: string): Promise<string>;
    downloadProfilePic(mobile: string, index: number): Promise<string>;
    updateUsername(mobile: string, username: string): Promise<string>;
    getMediaMetadata(mobile: string, chatId: string, offset: number, limit: number): Promise<any>;
    downloadMediaFile(mobile: string, messageId: number, chatId: string, res: any): Promise<any>;
    forwardMessage(mobile: string, chatId: string, messageId: number): Promise<void>;
    leaveChannels(mobile: string): Promise<void>;
    leaveChannel(mobile: string, channel: string): Promise<void>;
    deleteChat(mobile: string, chatId: string): Promise<void>;
    updateNameandBio(mobile: string, firstName: string, about?: string): Promise<string>;
}
