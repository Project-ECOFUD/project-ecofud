import { Column, Model, Sequelize, Table } from "sequelize-typescript";
import env from "./env";

@Table({ timestamps: true, deletedAt: false, updatedAt: false })
export class Payment extends Model {
  @Column({ allowNull: false, unique: true })
  paymentRequest!: string;

  @Column({ allowNull: false, unique: true })
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
        ssl: true,
        rejectUnauthorized: false,
      }
    : undefined,
});
