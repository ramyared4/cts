import mongoose, { Document } from 'mongoose';
export type BuildDocument = Build & Document;
export declare class Build {
}
export declare const BuildSchema: mongoose.Schema<Build, mongoose.Model<Build, any, any, any, mongoose.Document<unknown, any, Build> & Build & Required<{
    _id: unknown;
}>, any>, {}, {}, {}, {}, mongoose.DefaultSchemaOptions, Build, mongoose.Document<unknown, {}, mongoose.FlatRecord<Build>> & mongoose.FlatRecord<Build> & Required<{
    _id: unknown;
}>>;
