import { Controller, Post, Get, HttpCode, HttpStatus, UseGuards, Param } from '@nestjs/common';
import { TrackerService } from './tracker.service';

@Controller('v1/tracker')
export class TrackerController {
    constructor(private readonly trackerService: TrackerService) { }

    /**
     * Manual trigger for stock check
     */
    @Post('check')
    @HttpCode(HttpStatus.OK)
    async triggerStockCheck() {
        return await this.trackerService.runStockCheck();
    }

    /**
     * Manual trigger for stock check for single product
     */
    @Post('check/:uuid')
    @HttpCode(HttpStatus.OK)
    async triggerStockCheckSingle(@Param('uuid') uuid: string) {
        return await this.trackerService.runStockCheckSingle(uuid);
    }

    /**
     * Get current status of the tracker
     */
    @Get('status')
    async getStatus() {
        return {
            status: 'running',
            lastCheck: new Date().toISOString(),
        };
    }
}