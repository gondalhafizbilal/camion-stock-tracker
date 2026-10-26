import * as fs from "node:fs";
import * as path from "node:path";

import { SnakeNamingStrategy } from "typeorm-naming-strategies";

import { Module } from '@nestjs/common';

import {
  ConfigModule,
  ConfigService,
} from "@nestjs/config";

import { TypeOrmModule } from "@nestjs/typeorm";

import { ScheduleModule } from '@nestjs/schedule';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TrackerModule } from './tracker/tracker.module';
import { StockHistory } from "./tracker/entities/stock-history.entity";
import { ExportModule } from './export/export.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: "postgres",
        ssl: configService.get<string>("NODE_ENV") === "local"
          ? false
          : {
            rejectUnauthorized: false,
            ca: fs.readFileSync(path.join(process.cwd(), "ca/global-bundle.pem"), "utf-8"),
          },
        host: configService.get<string>("DB_HOST"),
        port: configService.get<number>("DB_PORT"),
        username: configService.get<string>("DB_USERNAME"),
        password: configService.get<string>("DB_PASSWORD"),
        database: configService.get<string>("DB_DATABASE"),
        synchronize: true,
        namingStrategy: new SnakeNamingStrategy(),
        logging: false,
        keepConnectionAlive: true,
        extra: {
          max: 20,
          idleTimeoutMillis: 30000,
          connectionTimeoutMillis: 5000,
          keepAlive: true,
          keepAliveInitialDelayMillis: 10000,
        },
        poolSize: 10,
        entities: [
          StockHistory,
        ],
      }),
    }),
    TrackerModule,
    ExportModule
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
