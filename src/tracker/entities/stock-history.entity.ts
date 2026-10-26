import {
    Entity,
    Column,
    PrimaryGeneratedColumn,
    CreateDateColumn,
    Index,
    UpdateDateColumn,
} from 'typeorm';

import { Exclude } from "class-transformer";

export enum StockChangeType {
    OUT_OF_STOCK = 'out_of_stock',
    BACK_IN_STOCK = 'back_in_stock',
    STOCK_DECREASED = 'stock_decreased',
    STOCK_INCREASED = 'stock_increased',
    NO_CHANGE = 'no_change',
    N0_VARIANT = 'no_variant',
    ERROR = 'error',
}

@Entity('stock_history')
export class StockHistory {
    @Exclude()
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ type: 'uuid', unique: true })
    uuid: string;

    @Column({ type: 'uuid' })
    @Index()
    productUuid: string;

    @Column({ type: 'uuid', nullable: true })
    @Index()
    variantUuid: string | null;

    @Column({ type: 'varchar', nullable: true })
    productSku: string | null;

    @Column({ type: 'varchar', nullable: true })
    procurementId: string;

    @Column({ type: 'integer', default: 0 })
    previousStock: number;

    @Column({ type: 'integer', default: 0 })
    currentStock: number;

    @Column({
        type: 'enum',
        enum: StockChangeType,
        default: StockChangeType.NO_CHANGE,
    })
    changeType: StockChangeType;

    @Column({ type: 'jsonb', nullable: true })
    metadata: Record<string, any>;

    @Column({ type: 'text', nullable: true })
    errorMessage: string;

    @Column({ type: 'boolean', default: false })
    notificationSent: boolean;

    @CreateDateColumn({ type: 'timestamptz' })
    checkedAt: Date;

    @Exclude()
    @CreateDateColumn({ name: 'created_at', type: 'timestamptz', nullable: false })
    createdAt: Date;

    @Exclude()
    @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz', nullable: false })
    updatedAt: Date;
}