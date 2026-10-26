import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Res,
} from '@nestjs/common';

import * as fs from 'fs';
import * as path from 'path';
import express from 'express';

import { ExportService } from './export.service';

@Controller('v1/export')
export class ExportController {
  private readonly logger =
    new Logger(ExportController.name);

  constructor(
    private readonly productionExportService:
      ExportService,
  ) { }

  /**
   * Export all production products into one Excel file.
   *
   * GET /v1/export/production/products
   */
  @Get('production/products')
  @HttpCode(HttpStatus.OK)
  async exportProductionProducts(
    @Res() res: express.Response,
  ): Promise<void> {
    const requestStartedAt = Date.now();

    this.logger.log(
      'Production product export requested',
    );

    try {
      const result =
        await this.productionExportService
          .exportProductsToExcel();

      const filename =
        path.basename(result.filePath);

      const fileSize =
        fs.statSync(result.filePath).size;

      this.logger.log(
        `Sending production export: ${filename}`,
      );

      this.logger.log(
        `Products: ${result.productsCount}, ` +
        `Pages: ${result.pagesProcessed}, ` +
        `Size: ${fileSize} bytes`,
      );

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );

      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${filename}"`,
      );

      res.setHeader(
        'Content-Length',
        fileSize,
      );

      const fileStream =
        fs.createReadStream(
          result.filePath,
        );

      fileStream.on('error', (error) => {
        this.logger.error(
          `Export file stream failed: ${error.message}`,
          error.stack,
        );

        if (!res.headersSent) {
          res.status(
            HttpStatus.INTERNAL_SERVER_ERROR,
          ).json({
            success: false,
            message:
              'Failed to download export file',
          });
        } else {
          res.destroy(error);
        }
      });

      fileStream.on('close', () => {
        this.logger.log(
          `Production export download completed: ${filename}`,
        );

        this.logger.log(
          `Total request duration: ${Date.now() -
          requestStartedAt
          }ms`,
        );
      });

      fileStream.pipe(res);
    } catch (error: any) {
      this.logger.error(
        `Production export request failed: ${error.message}`,
        error.stack,
      );

      if (!res.headersSent) {
        res.status(
          HttpStatus.INTERNAL_SERVER_ERROR,
        ).json({
          success: false,
          message:
            'Failed to export production products',
          error: error.message,
        });
      }
    }
  }
}
