import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';

import { TrackerService } from './tracker.service';
import { TrackerController } from './tracker.controller';
import { TrackerScheduler } from './tracker.scheduler';

import { CamionApiProvider } from './providers/camion-api.provider';
import { GulltransApiProvider } from './providers/gulltrans-api.provider';
import { StockLoggerService } from './logger/stock-logger.service';

import { StockHistory } from './entities/stock-history.entity';

@Module({
    imports: [
        TypeOrmModule.forFeature([StockHistory]),
        ConfigModule,
    ],
    providers: [
        TrackerService,
        TrackerScheduler,
        CamionApiProvider,
        GulltransApiProvider,
        StockLoggerService,
    ],
    controllers: [TrackerController],
    exports: [TrackerService],
})
export class TrackerModule { }