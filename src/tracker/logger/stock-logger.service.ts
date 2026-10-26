import { Injectable, Logger } from '@nestjs/common';
import { StockChange } from '../types';
import { StockChangeType } from '../entities/stock-history.entity';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class StockLoggerService {
    private readonly logger = new Logger(StockLoggerService.name);
    private readonly logDir: string;

    constructor() {
        this.logDir = path.join(process.cwd(), 'logs');
        if (!fs.existsSync(this.logDir)) {
            fs.mkdirSync(this.logDir, { recursive: true });
        }
    }

    async logStockChanges(changes: StockChange[]): Promise<void> {
        if (changes.length === 0) return;

        const logFile = path.join(
            this.logDir,
            `stock-changes-${new Date().toISOString().split('T')[0]}.log`,
        );

        const logEntries = changes.map((change) => ({
            timestamp: new Date().toISOString(),
            productUuid: change.productUuid,
            variantUuid: change.variantUuid,
            productSku: change.productSku,
            procurementId: change.procurementId,
            previousStock: change.previousStock,
            currentStock: change.currentStock,
            changeType: change.changeType,
            metadata: change.metadata,
            ...(change.errorMessage && { errorMessage: change.errorMessage }),
        }));

        const logContent = logEntries
            .map((entry) => JSON.stringify(entry))
            .join('\n') + '\n';

        fs.appendFileSync(logFile, logContent);

        this.logger.log(
            `Logged ${changes.length} stock changes to ${logFile}`,
        );
    }

    async getRecentLogs(days: number = 7): Promise<string> {
        const logFiles = fs.readdirSync(this.logDir)
            .filter((f) => f.startsWith('stock-changes-') && f.endsWith('.log'))
            .sort()
            .slice(-days);

        let content = '';
        for (const file of logFiles) {
            const filePath = path.join(this.logDir, file);
            const fileContent = fs.readFileSync(filePath, 'utf-8');
            content += fileContent;
        }

        return content;
    }

    async getSummary(days: number = 7): Promise<{
        totalChanges: number;
        byType: Record<StockChangeType, number>;
        dateRange: { start: string; end: string };
    }> {
        const logs = await this.getRecentLogs(days);
        const entries = logs.trim().split('\n').filter(Boolean);

        const byType: Record<StockChangeType, number> = {
            [StockChangeType.OUT_OF_STOCK]: 0,
            [StockChangeType.BACK_IN_STOCK]: 0,
            [StockChangeType.STOCK_DECREASED]: 0,
            [StockChangeType.STOCK_INCREASED]: 0,
            [StockChangeType.NO_CHANGE]: 0,
            [StockChangeType.ERROR]: 0,
            [StockChangeType.N0_VARIANT]: 0,
        };

        for (const entry of entries) {
            try {
                const data = JSON.parse(entry);
                byType[data.changeType] = (byType[data.changeType] || 0) + 1;
            } catch {
                // Skip invalid entries
            }
        }

        const now = new Date();
        const start = new Date(now);
        start.setDate(start.getDate() - days);

        return {
            totalChanges: entries.length,
            byType,
            dateRange: {
                start: start.toISOString().split('T')[0],
                end: now.toISOString().split('T')[0],
            },
        };
    }
}