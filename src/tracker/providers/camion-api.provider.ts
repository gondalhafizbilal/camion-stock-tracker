import { Injectable, Logger, HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { CamionProduct } from '../types';
import { BulkStockUpdateDto, UpdateStockDto } from '../dtos/stock-update.dto';

@Injectable()
export class CamionApiProvider {
    private readonly logger = new Logger(CamionApiProvider.name);
    private readonly baseUrl: string;
    private readonly apiSecret: string;
    private readonly pageSize: number;
    private readonly maxPages: number;

    constructor(private readonly configService: ConfigService) {
        this.baseUrl =
            this.configService.get<string>('CAMION_EXPORT_API_URL') || '';

        this.apiSecret =
            this.configService.get<string>('CAMION_EXPORT_API_SECRET') || '';

        this.pageSize =
            Number(
                this.configService.get<string>('CAMION_EXPORT_PAGE_SIZE'),
            ) || 24;

        this.maxPages =
            Number(
                this.configService.get<string>('CAMION_EXPORT_MAX_PAGES'),
            ) || 10000;

        if (!this.baseUrl) {
            throw new Error(
                'CAMION_EXPORT_API_URL is not configured',
            );
        }

        if (!this.apiSecret) {
            throw new Error(
                'CAMION_EXPORT_API_SECRET is not configured',
            );
        }
    }

    private async fetchWithAuth<T>(
        endpoint: string,
        options: RequestInit = {},
    ): Promise<T> {
        const timestamp = Date.now().toString();

        const url = `${this.baseUrl}${endpoint}`;
        const headers = {
            'Authorization': `Bearer ${this.configService.get<string>('CAMION_API_SECRET')}`,
            'X-Timestamp': timestamp,
            'Content-Type': 'application/json',
            ...options.headers,
        };

        try {
            const response = await fetch(url, {
                ...options,
                headers,
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new HttpException(
                    `API request failed: ${errorText}`,
                    response.status,
                );
            }

            return await response.json();
        } catch (error: any) {
            if (error instanceof HttpException) {
                throw error;
            }
            this.logger.error(`Request failed: ${error.message}`);
            throw new HttpException(
                `Failed to fetch from Camion API: ${error.message}`,
                500,
            );
        }
    }

    async getProductsForExport(
        pageNumber: number,
    ): Promise<CamionProduct[]> {
        const timestamp = Date.now().toString();

        const url =
            `${this.baseUrl}/v1/products` +
            `?pageNumber=${pageNumber}` +
            `&itemsPerPage=${this.pageSize}`;

        this.logger.debug(
            `Fetching production products: page=${pageNumber}, pageSize=${this.pageSize}`,
        );

        try {
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    Authorization: `Bearer ${this.apiSecret}`,
                    'X-Timestamp': timestamp,
                    Accept: 'application/json',
                },
            });

            if (!response.ok) {
                const errorText = await response.text();

                this.logger.error(
                    `Production API failed: page=${pageNumber}, status=${response.status}, response=${errorText}`,
                );

                throw new HttpException(
                    `Production API request failed: ${errorText}`,
                    response.status,
                );
            }

            const products = await response.json();

            if (!Array.isArray(products)) {
                throw new Error(
                    `Unexpected production API response on page ${pageNumber}`,
                );
            }

            this.logger.debug(
                `Production API returned ${products.length} products for page ${pageNumber}`,
            );

            return products;
        } catch (error: any) {
            if (error instanceof HttpException) {
                throw error;
            }

            this.logger.error(
                `Production API request failed: page=${pageNumber}, error=${error.message}`,
                error.stack,
            );

            throw new HttpException(
                `Failed to fetch production products: ${error.message}`,
                500,
            );
        }
    }

    getPageSize(): number {
        return this.pageSize;
    }

    getMaxPages(): number {
        return this.maxPages;
    }

    async getProducts(
        pageNumber: number = 1,
        itemsPerPage: number = 24,
    ): Promise<CamionProduct[]> {
        try {            
            this.logger.log(`Fetching products - page ${pageNumber}`);

            const response = await this.fetchWithAuth<CamionProduct[]>(
                `/v1/products?status=active&pageNumber=${pageNumber}&itemsPerPage=${itemsPerPage}`,
                {
                    method: 'GET',
                },
            );

            const products = response || [];

            return products;
        } catch (error: any) {
            this.logger.error(`Failed to fetch products: ${error.message}`);
            throw error;
        }
    }

    async getProduct(
        uuid: string
    ): Promise<CamionProduct> {
        try {
            this.logger.log(`Fetching product - ${uuid}`);

            const response = await this.fetchWithAuth<CamionProduct>(
                `/v1/products/${uuid}`,
                {
                    method: 'GET',
                },
            );

            const product = response || {};

            return product;
        } catch (error: any) {
            this.logger.error(`Failed to fetch products: ${error.message}`);
            throw error;
        }
    }

    async getProductByUuid(uuid: string): Promise<CamionProduct> {
        try {
            const response = await this.fetchWithAuth<CamionProduct>(
                `/v1/products/${uuid}`,
                { method: 'GET' },
            );
            return response;
        } catch (error: any) {
            this.logger.error(`Failed to fetch product ${uuid}: ${error.message}`);
            throw error;
        }
    }

    async updateVariantStock(update: UpdateStockDto): Promise<void> {
        try {
            await this.fetchWithAuth<void>(
                `/v1/inventory/variants/${update.variantUuid}/stock`,
                {
                    method: 'PATCH',
                    body: JSON.stringify({
                        quantity: update.quantity,
                        warehouseUuid: update.warehouseUuid,
                    }),
                },
            );
        } catch (error: any) {
            this.logger.error(
                `Failed to update stock for variant ${update.variantUuid}: ${error.message}`,
            );
            throw error;
        }
    }

    async bulkUpdateStock(updates: BulkStockUpdateDto): Promise<void> {
        try {
            
            await this.fetchWithAuth<void>('/v1/variants/bulk-stock-update', {
                method: 'PATCH',
                body: JSON.stringify(updates),
            });
            this.logger.log(`Bulk updated stock for ${updates.updates.length} variants`);
        } catch (error: any) {
            this.logger.error(`Failed to bulk update stock: ${error.message}`);
            throw error;
        }
    }

    async updateProcurementStatus(
        productUuid: string,
        status: true | false,
    ): Promise<void> {
        try {
            await this.fetchWithAuth<void>(`/v1/products/${productUuid}/procurement-status`, {
                method: 'Put',
                body: JSON.stringify({ status }),
            });
        } catch (error: any) {
            this.logger.error(
                `Failed to update product status ${productUuid}: ${error.message}`,
            );
            throw error;
        }
    }

    async updateProductStatus(
        productUuid: string,
        status: string,
    ): Promise<void> {
        try {
            await this.fetchWithAuth<void>(`/v1/products/${productUuid}/status`, {
                method: 'Put',
                body: JSON.stringify({ status }),
            });
        } catch (error: any) {
            this.logger.error(
                `Failed to update product status ${productUuid}: ${error.message}`,
            );
            throw error;
        }
    }

    async updateResyncStatus(
        productUuid: string,
        shouldResync: boolean,
    ): Promise<void> {
        try {
            await this.fetchWithAuth<void>(`/v1/products/${productUuid}/resync-status`, {
                method: 'Put',
                body: JSON.stringify({ shouldResync }),
            });
        } catch (error: any) {
            this.logger.error(
                `Failed to update resync status for ${productUuid}: ${error.message}`,
            );
            throw error;
        }
    }

    async getInventoryLevels(variantUuid: string) {
        try {
            return await this.fetchWithAuth<any>(
                `/v1/inventory/variants/${variantUuid}/levels`,
                { method: 'GET' },
            );
        } catch (error: any) {
            this.logger.error(
                `Failed to fetch inventory levels for ${variantUuid}: ${error.message}`,
            );
            throw error;
        }
    }
}