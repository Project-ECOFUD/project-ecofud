import { Column, DataType, Model, Sequelize, Table } from "sequelize-typescript";
import env from "./env";

@Table({ timestamps: true, deletedAt: false, updatedAt: false })
export class Payment extends Model {
  @Column({ type: DataType.STRING(1024), allowNull: false, unique: true })
  paymentRequest!: string;

  @Column({ type: DataType.STRING(1024), allowNull: false, unique: true })
  rHash!: string;

  @Column({ allowNull: false })
  amount!: number;

  @Column({ allowNull: true })
  paidAt!: Date;
}

export const db = new Sequelize(env.DATABASE_URL, {
  logging: false,
  models: [Payment],
  dialectOptions: env.DATABASE_SSL
    ? {
        ssl: {
          require: true,
          rejectUnauthorized: false,
        },
      }
    : undefined,
});
