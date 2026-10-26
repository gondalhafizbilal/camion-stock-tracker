import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { TrackerService } from './tracker.service';

@Injectable()
export class TrackerScheduler {
    private readonly logger = new Logger(TrackerScheduler.name);
    private isRunning = false;

    constructor(private readonly trackerService: TrackerService) { }

    /**
     * Run stock check daily at 2:00 AM
     */
    @Cron(CronExpression.EVERY_DAY_AT_2AM)
    async handleDailyStockCheck() {
        this.logger.log('Starting scheduled daily stock check...');
        await this.runStockCheck();
    }

    /**
     * Run stock check every hour for testing (only in development)
     */
    // @Cron(CronExpression.EVERY_HOUR)
    async handleHourlyStockCheck() {
        if (process.env.NODE_ENV === 'production') {
            return; // Skip in production
        }
        this.logger.log('Starting hourly stock check (development mode)...');
        await this.runStockCheck();
    }

    private async runStockCheck() {
        if (this.isRunning) {
            this.logger.warn('Stock check already running, skipping');
            return;
        }

        try {
            this.isRunning = true;
            const summary = await this.trackerService.runStockCheck();

            if (summary) {
                this.logger.log(
                    `Stock check completed: ${summary.totalChecked} products checked, ` +
                    `${summary.outOfStock} out of stock, ${summary.backInStock} back in stock`,
                );
            }
        } catch (error: any) {
            this.logger.error(`Stock check failed: ${error.message}`, error.stack);
        } finally {
            this.isRunning = false;
        }
    }
}