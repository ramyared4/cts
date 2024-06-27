import mongoose from 'mongoose';
export type UserDocument = User & Document;
export declare class User {
    mobile: string;
    session: string;
    firstName: string;
    lastName: string | null;
    username: string | null;
    channels: number;
    personalChats: number;
    demoGiven: boolean;
    msgs: number;
    totalChats: number;
    lastActive: string;
    date: string;
    tgId: string;
    lastUpdated: string;
    movieCount: number;
    photoCount: number;
    videoCount: number;
    gender: string | null;
    twoFA: boolean;
    password: string;
    otherPhotoCount: number;
    otherVideoCount: number;
    ownPhotoCount: number;
    ownVideoCount: number;
    contacts: number;
    calls: {
        outgoing: number;
        incoming: number;
        video: number;
        chatCallCounts: any[];
        totalCalls: number;
    };
}
export declare const UserSchema: mongoose.Schema<User, mongoose.Model<User, any, any, any, mongoose.Document<unknown, any, User> & User & {
    _id: mongoose.Types.ObjectId;
}, any>, {}, {}, {}, {}, mongoose.DefaultSchemaOptions, User, mongoose.Document<unknown, {}, mongoose.FlatRecord<User>> & mongoose.FlatRecord<User> & {
    _id: mongoose.Types.ObjectId;
}>;
