import { 
    Injectable, 
    Logger, 
    HttpException 
} from '@nestjs/common';

import { ConfigService } from '@nestjs/config';

import { GulltransAvailabilityResponse, GullTransProductResponse, GulltransSkuInfo, GullTransSkuResponse } from '../types';

@Injectable()
export class GulltransApiProvider {
    private readonly logger = new Logger(GulltransApiProvider.name);
    private readonly baseUrl: string;
    private readonly authorization: string;
    private readonly uuid: string;

    constructor(private readonly configService: ConfigService) {
        this.baseUrl = this.configService.get<string>('GULLTRANS_BASE_URL') || '';
        this.authorization = this.configService.get<string>('GULLTRANS_AUTHORIZATION') || '';
        this.uuid = this.configService.get<string>('GULLTRANS_UUID') || '';
    }

    private async fetchGulltrans<T>(
        endpoint: string,
        body: Record<string, unknown>,
    ): Promise<T> {
        const url = `${this.baseUrl}${endpoint}`;

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    Authorization: this.authorization,
                    'X-Uuid': this.uuid,
                    'Content-Type': 'application/json',
                    Language: 'en',
                },
                body: JSON.stringify(body),
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new HttpException(
                    `Gulltrans API error: ${errorText}`,
                    response.status,
                );
            }

            return await response.json();
        } catch (error: any) {
            if (error instanceof HttpException) {
                throw error;
            }
            this.logger.error(`Gulltrans request failed: ${error.message}`);
            throw new HttpException(
                `Failed to fetch from Gulltrans API: ${error.message}`,
                500,
            );
        }
    }

    /**
     * Check availability for a specific SKU (variant) from 1688
     * Maps the 1688 SKU to our variant using specId or skuId
     */
    async checkSkuAvailability(productId: string, productSkuInfos: GulltransSkuInfo[], variantSku: string, variantSkuMeta?: Record<string, any>): Promise<GullTransSkuResponse> {
        try {
            this.logger.log(`Checking SKU availability for product: ${productId}, variant: ${variantSku}`);

            if (!productSkuInfos || productSkuInfos.length === 0) {
                this.logger.warn(`No SKUs found for product ${productId}`);
                return {
                    available: false,
                    stock: 0,
                    skuInfo: null,
                };
            }

            // Find the matching SKU using specId from skuMeta
            let matchedSku: GulltransSkuInfo | null = null;
            let specId = variantSkuMeta?.spec_id || variantSkuMeta?.specId;

            if (specId) {
                matchedSku = productSkuInfos.find(
                    (sku) => String(sku.specId) === String(specId)
                ) ?? null;
            }

            if (!matchedSku) {
                matchedSku = productSkuInfos.find(
                    (sku) => String(sku.skuId) === variantSku ||
                        String(sku.specId) === variantSku
                ) ?? null;
            }

            if (!matchedSku) {
                this.logger.warn(
                    `No matching SKU found for variant ${variantSku} in product ${productId}. ` +
                    `Available SKUs: ${productSkuInfos.map(s => `${s.specId} (${s.skuId})`).join(', ')}`
                );
                return {
                    available: false,
                    stock: 0,
                    skuInfo: null,
                };
            }

            const isAvailable = matchedSku.amountOnSale > 0;

            this.logger.log(
                `SKU ${variantSku} (specId: ${matchedSku.specId}) - ` +
                `Available: ${isAvailable}, Stock: ${matchedSku.amountOnSale}`
            );

            return {
                available: isAvailable,
                stock: matchedSku.amountOnSale,
                skuInfo: {
                    specId: matchedSku.specId,
                    skuId: matchedSku.skuId,
                    available: isAvailable,
                    stock: matchedSku.amountOnSale,
                    price: matchedSku.price,
                    attributes: matchedSku.skuAttributes.map(attr => ({
                        name: attr.attributeName,
                        value: attr.value,
                    })),
                }
            };
        } catch (error: any) {
            if (error instanceof HttpException) {
                throw error;
            }

            this.logger.error(`Failed to check SKU availability for ${productId}: ${error.message}`);
            throw error;
        }
    }

    /**
     * Legacy method for backward compatibility - gets total product stock
     * (Not used for per-variant comparison)
     */
    async checkProductAvailability(productId: string): Promise<GullTransProductResponse> {
        try {
            this.logger.log(`Checking product availability (legacy) for: ${productId}`);

            const data = await this.fetchGulltrans<GulltransAvailabilityResponse>(
                '/api/client/third-purchase/info',
                {
                    keyword: productId,
                    platform: '1688',
                    use_platform: '1',
                },
            );

            if (data.ret !== 1) {
                const isAuthError = data.msg.includes('Unauthorized') || data.msg.includes('授权');
                if (isAuthError) {
                    this.logger.error(`Gulltrans authorization failed: ${data.msg}`);
                    throw new HttpException('Gulltrans authorization failed', 401);
                }

                this.logger.warn(`Gulltrans returned error for ${productId}: ${data.msg}`);
                return {
                    available: false,
                    stock: 0,
                    productDetail: null,
                };
            }

            const product = data.data.result;
            let totalStock = 0;

            if (product.productSkuInfos && product.productSkuInfos.length > 0) {
                totalStock = product.productSkuInfos.reduce((sum, sku) => {
                    return sum + (sku.amountOnSale || 0);
                }, 0);
            } else if (product.productSaleInfo?.amountOnSale) {
                totalStock = product.productSaleInfo.amountOnSale;
            }

            const isAvailable = totalStock > 0;

            this.logger.log(
                `Product ${productId} - Available: ${isAvailable}, Total Stock: ${totalStock}`,
            );

            return {
                available: isAvailable,
                stock: totalStock,
                productDetail: product,
            };
        } catch (error: any) {
            if (error instanceof HttpException && error.getStatus() === 404) {
                this.logger.warn(`Product ${productId} not found on 1688`);
                return {
                    available: false,
                    stock: 0,
                    productDetail: null,
                };
            }

            this.logger.error(`Failed to check product availability for ${productId}: ${error.message}`);
            throw error;
        }
    }
}
