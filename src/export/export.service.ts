import * as ExcelJS from 'exceljs';
import * as fs from 'fs';
import * as path from 'path';

import {
    Injectable,
    Logger,
    InternalServerErrorException,
} from '@nestjs/common';

import { CamionApiProvider } from '../tracker/providers/camion-api.provider';

import { ExportProductDto } from './dtos/export-response.dto';

@Injectable()
export class ExportService {
    private readonly logger = new Logger(ExportService.name);

    private readonly exportDir: string;

    constructor(
        private readonly camionProductionApi: CamionApiProvider,
    ) {
        this.exportDir = path.join(
            process.cwd(),
            'exports',
            'production',
        );

        if (!fs.existsSync(this.exportDir)) {
            fs.mkdirSync(this.exportDir, {
                recursive: true,
            });
        }
    }

    async exportProductsToExcel(): Promise<{
        filePath: string;
        productsCount: number;
        pagesProcessed: number;
    }> {
        const startedAt = Date.now();

        const timestamp = new Date()
            .toISOString()
            .replace(/[:.]/g, '-');

        const filename =
            `products-production-${timestamp}.xlsx`;

        const filePath = path.join(
            this.exportDir,
            filename,
        );

        this.logger.log(
            `Starting production product export`,
        );

        this.logger.log(
            `Production API: ${this.getSafeApiUrl()}`,
        );

        this.logger.log(
            `Output file: ${filePath}`,
        );

        let productsCount = 0;
        let pagesProcessed = 0;

        try {
            const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
                filename: filePath,
                useStyles: true,
                useSharedStrings: true,
            });

            workbook.creator = 'camion-stock-tracker';
            workbook.created = new Date();

            const worksheet = workbook.addWorksheet('Products');

            this.configureWorksheet(worksheet);

            const pageSize =
                this.camionProductionApi.getPageSize();

            const maxPages =
                this.camionProductionApi.getMaxPages();

            let pageNumber = 1;

            while (pageNumber <= maxPages) {
                const pageStartedAt = Date.now();

                this.logger.log(
                    `Fetching production page ${pageNumber}...`,
                );

                const products =
                    await this.camionProductionApi.getProductsForExport(
                        pageNumber,
                    );

                pagesProcessed++;

                this.logger.log(
                    `Page ${pageNumber}: received ${products.length} products`,
                );

                for (const product of products) {
                    const exportProduct =
                        this.transformProduct(product);

                    worksheet.addRow({
                        uuid: exportProduct.uuid,
                        slug: exportProduct.slug,
                        titleEn: exportProduct.titleEn,
                        titleAr: exportProduct.titleAr,
                        status: this.formatStatus(
                            exportProduct.status,
                        ),
                        procurementId:
                            exportProduct.procurementId || 'N/A',
                        shopId:
                            exportProduct.shopId || 'N/A',
                        shopName:
                            exportProduct.shopName || 'N/A',
                        variantsCount:
                            exportProduct.variantsCount,
                        totalStock:
                            exportProduct.totalStock,
                        minPrice:
                            exportProduct.minPrice,
                        maxPrice:
                            exportProduct.maxPrice,
                        avgPrice:
                            exportProduct.avgPrice,
                        createdAt:
                            this.formatDate(
                                exportProduct.createdAt,
                            ),
                        updatedAt:
                            this.formatDate(
                                exportProduct.updatedAt,
                            ),
                    }).commit();

                    productsCount++;
                }

                const pageDuration =
                    Date.now() - pageStartedAt;

                this.logger.log(
                    `Page ${pageNumber} processed in ${pageDuration}ms. ` +
                    `Total exported: ${productsCount}`,
                );

                /*
                 * The production API accepts a maximum of 24 products
                 * per page. If fewer than that are returned, we've
                 * reached the final page.
                 */
                if (products.length < pageSize) {
                    this.logger.log(
                        `Final page detected. ` +
                        `Received ${products.length}/${pageSize} products.`,
                    );

                    break;
                }

                pageNumber++;
            }

            if (pageNumber > maxPages) {
                throw new Error(
                    `Maximum export page limit (${maxPages}) reached. ` +
                    `Export stopped for safety.`,
                );
            }

            await worksheet.commit();
            await workbook.commit();

            const duration = Date.now() - startedAt;

            const fileSize =
                fs.statSync(filePath).size;

            this.logger.log(
                `Production export completed successfully.`,
            );

            this.logger.log(
                `Products exported: ${productsCount}`,
            );

            this.logger.log(
                `Pages processed: ${pagesProcessed}`,
            );

            this.logger.log(
                `File size: ${this.formatBytes(fileSize)}`,
            );

            this.logger.log(
                `Duration: ${duration}ms`,
            );

            return {
                filePath,
                productsCount,
                pagesProcessed,
            };
        } catch (error: any) {
            console.log("errorerrorerrorerror", error);
            
            this.logger.error(
                `Production export failed: ${error.message}`,
                error.stack,
            );

            /*
             * Don't leave a partially generated XLSX file behind.
             */
            if (fs.existsSync(filePath)) {
                try {
                    fs.unlinkSync(filePath);

                    this.logger.warn(
                        `Removed incomplete export file: ${filePath}`,
                    );
                } catch (cleanupError: any) {
                    this.logger.error(
                        `Failed to remove incomplete export: ${cleanupError.message}`,
                    );
                }
            }

            throw new InternalServerErrorException({
                error: 'Failed to export production products',
                details: error.message,
            });
        }
    }

    private configureWorksheet(
        worksheet: ExcelJS.Worksheet,
    ): void {
        worksheet.columns = [
            {
                header: 'Product UUID',
                key: 'uuid',
                width: 40,
            },
            {
                header: 'Slug',
                key: 'slug',
                width: 30,
            },
            {
                header: 'Title (English)',
                key: 'titleEn',
                width: 45,
            },
            {
                header: 'Title (Arabic)',
                key: 'titleAr',
                width: 45,
            },
            {
                header: 'Status',
                key: 'status',
                width: 15,
            },
            {
                header: 'Procurement ID',
                key: 'procurementId',
                width: 20,
            },
            {
                header: 'Shop ID',
                key: 'shopId',
                width: 25,
            },
            {
                header: 'Shop Name',
                key: 'shopName',
                width: 35,
            },
            {
                header: 'Variants Count',
                key: 'variantsCount',
                width: 18,
            },
            {
                header: 'Total Stock',
                key: 'totalStock',
                width: 18,
            },
            {
                header: 'Min Price',
                key: 'minPrice',
                width: 18,
                style: {
                    numFmt: '$#,##0.00',
                },
            },
            {
                header: 'Max Price',
                key: 'maxPrice',
                width: 18,
                style: {
                    numFmt: '$#,##0.00',
                },
            },
            {
                header: 'Avg Price',
                key: 'avgPrice',
                width: 18,
                style: {
                    numFmt: '$#,##0.00',
                },
            },
            {
                header: 'Created At',
                key: 'createdAt',
                width: 25,
            },
            {
                header: 'Updated At',
                key: 'updatedAt',
                width: 25,
            },
        ];

        const headerRow = worksheet.getRow(1);

        headerRow.font = {
            bold: true,
            color: {
                argb: 'FFFFFFFF',
            },
        };

        headerRow.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: {
                argb: 'FF4F46E5',
            },
        };

        headerRow.alignment = {
            horizontal: 'center',
            vertical: 'middle',
        };

        headerRow.height = 25;

        worksheet.autoFilter = {
            from: 'A1',
            to: 'O1',
        };

        headerRow.commit();
    }

    private transformProduct(
        product: any,
    ): ExportProductDto {
        let totalStock = 0;

        const prices: number[] = [];

        if (
            product.variants &&
            Array.isArray(product.variants)
        ) {
            for (const variant of product.variants) {
                if (
                    variant.inventoryItem?.levels &&
                    Array.isArray(
                        variant.inventoryItem.levels,
                    )
                ) {
                    for (
                        const level
                        of variant.inventoryItem.levels
                    ) {
                        totalStock +=
                            Number(level.quantity) || 0;
                    }
                }

                if (
                    variant.cost?.amount !== undefined &&
                    variant.cost?.amount !== null
                ) {
                    prices.push(
                        Number(variant.cost.amount),
                    );
                }

                if (
                    variant.price?.amount !== undefined &&
                    variant.price?.amount !== null
                ) {
                    prices.push(
                        Number(variant.price.amount),
                    );
                }
            }
        }

        const minPrice =
            prices.length > 0
                ? Math.min(...prices)
                : null;

        const maxPrice =
            prices.length > 0
                ? Math.max(...prices)
                : null;

        const avgPrice =
            prices.length > 0
                ? Math.round(
                    (
                        prices.reduce(
                            (sum, price) =>
                                sum + price,
                            0,
                        ) /
                        prices.length
                    ) * 100,
                ) / 100
                : null;

        return {
            uuid: product.uuid,
            slug: product.slug,
            titleEn: product.titleEn || '',
            titleAr: product.titleAr || '',
            status: product.status || 'draft',
            procurementId:
                product.procurementId || null,
            shopId:
                product.shopId || null,
            shopName:
                product.shopName || null,
            variantsCount:
                product.variants?.length || 0,
            totalStock,
            minPrice,
            maxPrice,
            avgPrice,
            createdAt:
                product.createdAt ||
                new Date().toISOString(),
            updatedAt:
                product.updatedAt ||
                new Date().toISOString(),
        };
    }

    private formatStatus(
        status: string,
    ): string {
        const statusMap: Record<string, string> = {
            active: 'Active',
            archived: 'Archived',
            draft: 'Draft',
            ACTIVE: 'Active',
            ARCHIVED: 'Archived',
            DRAFT: 'Draft',
        };

        return (
            statusMap[status] ||
            status ||
            'Unknown'
        );
    }

    private formatDate(
        value: string | Date,
    ): string {
        const date = new Date(value);

        if (Number.isNaN(date.getTime())) {
            return '';
        }

        return date.toLocaleString();
    }

    private formatBytes(
        bytes: number,
    ): string {
        if (bytes === 0) {
            return '0 Bytes';
        }

        const units = [
            'Bytes',
            'KB',
            'MB',
            'GB',
        ];

        const index = Math.floor(
            Math.log(bytes) /
            Math.log(1024),
        );

        return (
            `${parseFloat(
                (
                    bytes /
                    Math.pow(1024, index)
                ).toFixed(2),
            )} ${units[index]}`
        );
    }

    private getSafeApiUrl(): string {
        return this.camionProductionApi
            ? 'https://api.camion-app.com'
            : 'production-api';
    }
}