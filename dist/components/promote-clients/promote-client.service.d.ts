import { ChannelsService } from '../channels/channels.service';
import { Model } from 'mongoose';
import { CreatePromoteClientDto } from './dto/create-promote-client.dto';
import { PromoteClient, PromoteClientDocument } from './schemas/promote-client.schema';
import { TelegramService } from '../Telegram/Telegram.service';
import { UsersService } from '../users/users.service';
import { ActiveChannelsService } from '../active-channels/active-channels.service';
import { ClientService } from '../clients/client.service';
import { UpdatePromoteClientDto } from './dto/update-promote-client.dto';
export declare class PromoteClientService {
    private promoteClientModel;
    private telegramService;
    private usersService;
    private activeChannelsService;
    private clientService;
    private channelsService;
    private joinChannelMap;
    private joinChannelIntervalId;
    constructor(promoteClientModel: Model<PromoteClientDocument>, telegramService: TelegramService, usersService: UsersService, activeChannelsService: ActiveChannelsService, clientService: ClientService, channelsService: ChannelsService);
    create(promoteClient: CreatePromoteClientDto): Promise<PromoteClient>;
    findAll(): Promise<PromoteClient[]>;
    findOne(mobile: string): Promise<PromoteClient>;
    update(mobile: string, updateClientDto: UpdatePromoteClientDto): Promise<PromoteClient>;
    createOrUpdate(mobile: string, createOrUpdateUserDto: CreatePromoteClientDto | UpdatePromoteClientDto): Promise<PromoteClient>;
    remove(mobile: string): Promise<void>;
    search(filter: any): Promise<PromoteClient[]>;
    executeQuery(query: any, sort?: any, limit?: number, skip?: number): Promise<PromoteClient[]>;
    removeFromPromoteMap(key: string): void;
    clearPromoteMap(): void;
    joinchannelForPromoteClients(): Promise<string>;
    joinChannelQueue(): Promise<void>;
    clearJoinChannelInterval(): void;
    setAsPromoteClient(mobile: string, availableDate?: string): Promise<string>;
    checkPromoteClients(): Promise<void>;
    addNewUserstoPromoteClients(badIds: string[], goodIds: string[]): Promise<void>;
}
