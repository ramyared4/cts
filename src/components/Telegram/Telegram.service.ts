import { BufferClientService } from './../buffer-clients/buffer-client.service';
import { UsersService } from '../users/users.service';
import { contains, sleep } from "../../utils";
import TelegramManager from "./TelegramManager";
import { BadRequestException, HttpException, Inject, Injectable, OnModuleDestroy, forwardRef } from '@nestjs/common';
import { CloudinaryService } from '../../cloudinary';
import { Api, TelegramClient } from 'telegram';
import { ActiveChannelsService } from '../active-channels/active-channels.service';
import * as path from 'path';
import { ChannelsService } from '../channels/channels.service';
import { Channel } from '../channels/schemas/channel.schema';
import { EntityLike } from 'telegram/define';
import { parseError } from '../../utils/parseError';

@Injectable()
export class TelegramService implements OnModuleDestroy {
    private static clientsMap: Map<string, TelegramManager> = new Map();
    constructor(
        @Inject(forwardRef(() => UsersService))
        private usersService: UsersService,
        private bufferClientService: BufferClientService,
        @Inject(forwardRef(() => ActiveChannelsService))
        private activeChannelsService: ActiveChannelsService,
        @Inject(forwardRef(() => ChannelsService))
        private channelsService: ChannelsService,
    ) {}

    async onModuleDestroy() {
        await this.disconnectAll();
    }

    public getActiveClientSetup() {
        return TelegramManager.getActiveClientSetup();
    }

    public setActiveClientSetup(data: { days?: number, archiveOld: boolean, formalities: boolean, newMobile: string, existingMobile: string, clientId: string } | undefined) {
        TelegramManager.setActiveClientSetup(data);
    }

    public async getClient(number: string) {
        const client = TelegramService.clientsMap.get(number);
        try {
            if (client && client.connected()) {
                await client.connect()
                return client
            }
        } catch (error) {
            console.log(error)
        }
        return undefined;
    }

    public hasClient(number: string) {
        return TelegramService.clientsMap.has(number);
    }

    async deleteClient(number: string) {
        const cli = await this.getClient(number);
        await cli?.disconnect();
        console.log("Disconnected : ", number)
        return TelegramService.clientsMap.delete(number);
    }

    async disconnectAll() {
        const data = TelegramService.clientsMap.entries();
        console.log("Disconnecting All Clients");
        for (const [phoneNumber, client] of data) {
            try {
                await client?.disconnect();
                TelegramService.clientsMap.delete(phoneNumber);
                console.log(`Client disconnected: ${phoneNumber}`);
            } catch (error) {
                console.log(parseError(error));
                console.log(`Failed to Disconnect : ${phoneNumber}`);
            }
        }
        TelegramService.clientsMap.clear();
        // this.bufferClientService.clearBufferMap()
        this.bufferClientService.clearJoinChannelInterval()
    }

    async createClient(mobile: string, autoDisconnect = true, handler = true): Promise<TelegramManager> {
        const user = (await this.usersService.search({ mobile }))[0];
        if (!user) {
            throw new BadRequestException('user not found');
        }
        if (!this.hasClient(mobile)) {
            let telegramManager = new TelegramManager(user.session, user.mobile);
            let client: TelegramClient
            try {
                client = await telegramManager.createClient(handler);
                await client.getMe();
                if (client) {
                    TelegramService.clientsMap.set(mobile, telegramManager);
                    if (autoDisconnect) {
                        setTimeout(async () => {
                            if (client.connected || await this.getClient(mobile)) {
                                console.log("SELF destroy client : ", mobile);
                                await telegramManager.disconnect();
                            } else {
                                console.log("Client Already Disconnected : ", mobile);
                            }
                            TelegramService.clientsMap.delete(mobile);
                        }, 180000)
                    } else {
                        setInterval(async () => {
                            //console.log("destroying loop :", mobile)
                            //client._destroyed = true
                            // if (!client.connected) {
                            // await client.connect();
                            //}
                        }, 20000);
                    }
                    return telegramManager;
                } else {
                    throw new BadRequestException('Client Expired');
                }
            } catch (error) {
                console.log("Parsing Error");
                if (telegramManager) {
                    await telegramManager.disconnect();
                    telegramManager = null;
                    TelegramService.clientsMap.delete(mobile);
                }
                const errorDetails = parseError(error);
                if (contains(errorDetails.message.toLowerCase(), ['expired', 'unregistered', 'deactivated', "session_revoked", "user_deactivated_ban"])) {
                    console.log("Deleting User: ", user.mobile);
                    await this.usersService.updateByFilter({ $or: [{ tgId: user.tgId }, { mobile: mobile }] }, { expired: true });
                } else {
                    console.log('Not Deleting user');
                }
                throw new BadRequestException(errorDetails.message)
            }
        } else {
            console.log("Client Already exists")
            return await this.getClient(mobile)
        }
    }

    async getMessages(mobile: string, username: string, limit: number = 8) {
        const telegramClient = await this.getClient(mobile)
        return telegramClient.getMessages(username, limit);
    }


    async getMessagesNew(mobile: string, username: string, offset: number, limit: number) {
        const telegramClient = await this.getClient(mobile)
        return telegramClient.getMessagesNew(username, offset, limit);
    }

    async sendInlineMessage(mobile: string, chatId: string, message: string, url: string) {
        const telegramClient = await this.getClient(mobile)
        return telegramClient.sendInlineMessage(chatId, message, url);
    }

    async getChatId(mobile: string, username: string) {
        const telegramClient = await this.getClient(mobile)
        return await telegramClient.getchatId(username);
    }

    async getLastActiveTime(mobile: string) {
        const telegramClient = await this.getClient(mobile)
        return await telegramClient.getLastActiveTime();
    }

    // async joinChannels(mobile: string, channels: Channel[]) {
    //     console.log("Started Joining- ", mobile, " - channelsLen - ", channels.length);

    //     const joinChannelWithDelay = async (index: number) => {
    //         const telegramClient = await this.createClient(mobile, false, false)
    //         if (index >= channels.length) {
    //             console.log(mobile, " - finished joining channels");
    //             await this.deleteClient(mobile);
    //             console.log("Join channel stopped : ", mobile);
    //             return;
    //         }

    //         console.log(mobile, " - Will Try next now");
    //         const channel = channels[index]
    //         const username = channel.username;
    //         console.log(mobile, "Trying: ", username);
    //         try {
    //             await tryJoiningChannel(telegramClient, channel, username, mobile);
    //         } catch (error) {
    //             parseError(error, "Outer Err: ");
    //             await this.removeChannels(error, channel.channelId, channel.username);
    //         }
    //         console.log(mobile, " - On waiting period");
    //         await this.deleteClient(mobile)
    //         this.joinChannelTimeoutId = setTimeout(async () => {
    //             joinChannelWithDelay(index + 1);
    //         }, 3 * 60 * 1000);
    //     };



    //     joinChannelWithDelay(0);
    //     return 'Channels joining in progress';
    // }
    async tryJoiningChannel(mobile: string, chatEntity: Channel) {
        const telegramClient = await this.getClient(mobile)
        try {
            await telegramClient.joinChannel(chatEntity.username);
            console.log(telegramClient.phoneNumber, " - Joined channel Success - ", chatEntity.username);
            if (chatEntity.canSendMsgs) {
                // try {
                //     await this.activeChannelsService.update(chatEntity.channelId, chatEntity);
                //     console.log("updated ActiveChannels");
                // } catch (error) {
                //     console.log(parseError(error));
                //     console.log("Failed to update ActiveChannels");
                // }
            } else {
                await this.channelsService.remove(chatEntity.channelId);
                await this.activeChannelsService.remove(chatEntity.channelId);
                console.log("Removed Channel- ", chatEntity.username);
            }
        } catch (error) {
            console.log(telegramClient.phoneNumber, " - Failed to join - ", chatEntity.username);
            this.removeChannels(error, chatEntity.channelId, chatEntity.username);
            throw error
        }
    };

    async removeChannels(error: any, channelId: string, username: string) {
        if (error.errorMessage == "USERNAME_INVALID" || error.errorMessage == 'CHAT_INVALID' || error.errorMessage == 'USERS_TOO_MUCH' || error.toString().includes("No user has")) {
            try {
                if (channelId) {
                    await this.channelsService.remove(channelId)
                    await this.activeChannelsService.remove(channelId);
                    console.log("Removed Channel- ", channelId);
                } else {
                    const channelDetails = (await this.channelsService.search({ username: username }))[0];
                    await this.channelsService.remove(channelDetails.channelId)
                    await this.activeChannelsService.remove(channelDetails.channelId);
                    console.log("Removed Channel - ", channelDetails.channelId);
                }
            } catch (searchError) {
                console.log("Failed to search/remove channel: ", searchError);
            }
        } else if (error.errorMessage === "CHANNEL_PRIVATE") {
            await this.channelsService.update(channelId, { private: true })
            await this.activeChannelsService.update(channelId, { private: true });
        }
    }

    async getGrpMembers(mobile: string, entity: EntityLike) {
        try {
            const telegramClient = await this.getClient(mobile);
            return await telegramClient.getGrpMembers(entity)
        } catch (err) {
            console.error("Error fetching group members:", err);
        }
    }

    async addContact(mobile: string, data: { mobile: string, tgId: string }[], prefix: string) {
        try {
            const telegramClient = await this.getClient(mobile);
            return await telegramClient.addContact(data, prefix)
        } catch (err) {
            console.error("Error fetching adding Contacts:", err);
        }
    }


    async addContacts(mobile: string, phoneNumbers: string[], prefix: string) {
        try {
            const telegramClient = await this.getClient(mobile);
            return await telegramClient.addContacts(phoneNumbers, prefix)
        } catch (err) {
            console.error("Error fetching adding Contacts:", err);
        }
    }

    async removeOtherAuths(mobile: string) {
        const telegramClient = await this.getClient(mobile)
        await telegramClient.removeOtherAuths();
        return 'Authorizations removed successfully';
    }

    //@apiresponse({ status: 400, description: 'Bad request' })
    async getSelfMsgsInfo(mobile: string) {
        const telegramClient = await this.getClient(mobile)
        return await telegramClient.getSelfMSgsInfo();
    }

    async createGroup(mobile: string) {
        const telegramClient = await this.getClient(mobile)
        return await telegramClient.createGroup();
    }

    async forwardSecrets(mobile: string, fromChatId: string) {
        const telegramClient = await this.getClient(mobile)
        return await telegramClient.createGroupAndForward(fromChatId);
    }


    async joinChannelAndForward(mobile: string, fromChatId: string, channel: string) {
        const telegramClient = await this.getClient(mobile)
        return await telegramClient.joinChannelAndForward(fromChatId, channel);
    }


    async getCallLog(mobile: string) {
        const telegramClient = await this.getClient(mobile)
        return await telegramClient.getCallLog();
    }

    async getmedia(mobile: string) {
        const telegramClient = await this.getClient(mobile)
        return await telegramClient.getMediaMessages();
    }

    async getChannelInfo(mobile: string, sendIds: boolean = false) {
        const telegramClient = await this.getClient(mobile)
        const result = await telegramClient.getDialogs({ limit: 10, archived: false })
        // console.log(result)
        return await telegramClient.channelInfo(sendIds);
    }

    async getAuths(mobile: string) {
        const telegramClient = await this.getClient(mobile)
        return await telegramClient.getAuths();
    }

    async getMe(mobile: string) {
        const telegramClient = await this.getClient(mobile)
        return await telegramClient.getMe();
    }

    async createNewSession(mobile: string) {
        const telegramClient = await this.getClient(mobile)
        return await telegramClient.createNewSession();
    }

    async set2Fa(mobile: string) {
        const telegramClient = await this.getClient(mobile)
        try {
            await telegramClient.set2fa();
            await telegramClient.disconnect();
            return '2Fa set successfully'
        } catch (error) {
            const errorDetails = parseError(error)
            throw new HttpException(errorDetails.message, errorDetails.status)
        }
    }

    async updatePrivacyforDeletedAccount(mobile: string) {
        const telegramClient = await this.getClient(mobile);
        await telegramClient.updatePrivacyforDeletedAccount()
    }

    async deleteProfilePhotos(mobile: string) {
        const telegramClient = await this.getClient(mobile);
        await telegramClient.deleteProfilePhotos()
    }

    async setProfilePic(
        mobile: string, name: string,
    ) {
        const telegramClient = await this.getClient(mobile)
        await telegramClient.deleteProfilePhotos();
        try {
            await CloudinaryService.getInstance(name);
            await sleep(2000);
            const rootPath = process.cwd();
            console.log("checking path", rootPath)
            await telegramClient.updateProfilePic(path.join(rootPath, 'dp1.jpg'));
            await sleep(3000);
            await telegramClient.updateProfilePic(path.join(rootPath, 'dp2.jpg'));
            await sleep(3000);
            await telegramClient.updateProfilePic(path.join(rootPath, 'dp3.jpg'));
            await sleep(1000);
            await telegramClient.disconnect();
            return 'Profile pic set successfully'
        } catch (error) {
            const errorDetails = parseError(error)
            throw new HttpException(errorDetails.message, errorDetails.status)
        }
    }

    async updatePrivacy(
        mobile: string,
    ) {
        const telegramClient = await this.getClient(mobile)
        try {
            await telegramClient.updatePrivacy()
            return "Privacy updated successfully";
        } catch (error) {
            const errorDetails = parseError(error)
            throw new HttpException(errorDetails.message, errorDetails.status)
        }
    }

    async downloadProfilePic(
        mobile: string, index: number
    ) {
        const telegramClient = await this.getClient(mobile)
        try {
            return await telegramClient.downloadProfilePic(index)
        } catch (error) {
            console.log("Some Error: ", parseError(error), error);
            throw new Error("Failed to update username");
        }
    }

    async updateUsername(
        mobile: string, username: string,
    ) {
        const telegramClient = await this.getClient(mobile)
        try {
            return await telegramClient.updateUsername(username)
        } catch (error) {
            console.log("Some Error: ", parseError(error), error);
            throw new Error("Failed to update username");
        }
    }

    async getMediaMetadata(mobile: string, chatId: string, offset: number, limit: number) {
        const telegramClient = await this.getClient(mobile)
        return await telegramClient.getMediaMetadata(chatId, offset, limit);
    }

    async downloadMediaFile(mobile: string, messageId: number, chatId: string, res: any) {
        const telegramClient = await this.getClient(mobile)
        return await telegramClient.downloadMediaFile(messageId, chatId, res)
    }

    async forwardMessage(mobile: string, chatId: string, messageId: number) {
        const telegramClient = await this.getClient(mobile)
        return await telegramClient.forwardMessage(chatId, messageId);
    }

    async leaveChannels(mobile: string) {
        const telegramClient = await this.getClient(mobile)
        const channelinfo = await telegramClient.channelInfo(false);
        const leaveChannelIds = channelinfo.canSendFalseChats
        return await telegramClient.leaveChannels(leaveChannelIds);
    }


    async leaveChannel(mobile: string, channel: string) {
        const telegramClient = await this.getClient(mobile)
        return await telegramClient.leaveChannels([channel]);
    }


    async deleteChat(mobile: string, chatId: string) {
        const telegramClient = await this.getClient(mobile)
        return await telegramClient.deleteChat(chatId);
    }
    async updateNameandBio(
        mobile: string,
        firstName: string,
        about?: string,
    ) {
        const telegramClient = await this.getClient(mobile)
        try {
            await telegramClient.updateProfile(firstName, about)
            return "Username updated successfully";
        } catch (error) {
            console.log("Some Error: ", parseError(error), error);
            throw new Error("Failed to update username");
        }
    }
}
