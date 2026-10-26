import crypto from "node:crypto";

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';

import { CamionApiProvider } from './providers/camion-api.provider';
import { GulltransApiProvider } from './providers/gulltrans-api.provider';
import { StockLoggerService } from './logger/stock-logger.service';

import { StockHistory, StockChangeType } from './entities/stock-history.entity';
import { GulltransProductDetail, GulltransSkuInfo, StockChange, StockChangeSummary } from './types';
import { CamionProduct, CamionVariant } from './types';

@Injectable()
export class TrackerService {
    private readonly logger = new Logger(TrackerService.name);
    private readonly batchSize: number;
    private readonly concurrentRequests: number;
    private isRunning = false;

    constructor(
        @InjectRepository(StockHistory)
        private readonly stockHistoryRepository: Repository<StockHistory>,
        private readonly camionApi: CamionApiProvider,
        private readonly gulltransApi: GulltransApiProvider,
        private readonly stockLogger: StockLoggerService,
        private readonly configService: ConfigService,
    ) {
        this.batchSize = this.configService.get<number>('BATCH_SIZE', 50);
        this.concurrentRequests = this.configService.get<number>(
            'CONCURRENT_REQUESTS',
            5,
        );
    }

    /**
     * Main method to run the stock check
     */
    async runStockCheck(): Promise<StockChangeSummary | null> {
        if (this.isRunning) {
            this.logger.warn('Stock check already running, skipping');
            return null;
        }

        this.isRunning = true;
        const startTime = Date.now();
        this.logger.log('Starting stock availability check');

        try {
            // Step 1: Fetch all products with procurementId (1688 products)
            const products = await this.fetchAllProducts();

            const productMap = this.mapProductsByProcurementId(products);

            this.logger.log(`Found ${products.length} products from 1688`);

            if (products.length === 0) {
                this.logger.warn('No 1688 products found to check');
                return {
                    totalChecked: 0,
                    outOfStock: 0,
                    backInStock: 0,
                    stockDecreased: 0,
                    stockIncreased: 0,
                    errors: 0,
                    changes: [],
                };
            }

            // Step 2: Check availability for each product
            const availabilityResults = await this.checkAllProductsAvailability(productMap);

            // Step 3: Process results and detect changes
            const { changes, productStockStatus } = await this.processAvailabilityResults(availabilityResults, productMap);

            // Products with at least one variant that no longer matches any 1688 SKU have a
            // stale mapping - their stock data can't be trusted, so they're handled separately
            // (zero every variant, flag for manual resync) instead of going through the normal
            // per-variant update/archive flow below.
            const resyncProductUuids = new Set(
                Array.from(productStockStatus.entries())
                    .filter(([, status]) => status.hasUnmatchedSku)
                    .map(([productUuid]) => productUuid),
            );
            const normalChanges = changes.filter((c) => !resyncProductUuids.has(c.productUuid));

            // Step 4: Apply stock updates to Camion
            await this.applyStockUpdates(normalChanges);

            // Step 4b: Zero out and flag products whose 1688 SKUs no longer match ours
            await this.applyResyncUpdates(resyncProductUuids, productMap);

            // Step 5: Update product statuses (archive out-of-stock, reactivate back-in-stock)
            await this.updateProductStatuses(normalChanges, productStockStatus);

            // Step 6: Log changes and create summary
            const summary = this.createSummary(changes);

            const duration = Date.now() - startTime;
            this.logger.log(
                `Stock check completed in ${duration}ms: ${summary.totalChecked} products checked, ` +
                `${summary.outOfStock} out of stock, ${summary.backInStock} back in stock`,
            );

            return summary;
        } catch (error: any) {
            this.logger.error(`Stock check failed: ${error.message}`, error.stack);
            throw error;
        } finally {
            this.isRunning = false;
        }
    }

    /**
     * Main method to run the stock check
     */
    async runStockCheckSingle(uuid: string): Promise<StockChangeSummary | null> {
        if (this.isRunning) {
            this.logger.warn('Stock check already running, skipping');
            return null;
        }

        this.isRunning = true;
        const startTime = Date.now();
        this.logger.log('Starting stock availability check');

        try {
            // Step 1: Fetch all products with procurementId (1688 products)
            const products: CamionProduct[] = [];
            const product = await this.camionApi.getProduct(uuid);
            products.push(product);

            const productMap = this.mapProductsByProcurementId(products);

            this.logger.log(`Found ${products.length} products from 1688`);

            if (products.length === 0) {
                this.logger.warn('No 1688 products found to check');
                return {
                    totalChecked: 0,
                    outOfStock: 0,
                    backInStock: 0,
                    stockDecreased: 0,
                    stockIncreased: 0,
                    errors: 0,
                    changes: [],
                };
            }

            // Step 2: Check availability for each product
            const availabilityResults = await this.checkAllProductsAvailability(productMap);

            // Step 3: Process results and detect changes
            const { changes, productStockStatus } = await this.processAvailabilityResults(availabilityResults, productMap);

            // Products with at least one variant that no longer matches any 1688 SKU have a
            // stale mapping - their stock data can't be trusted, so they're handled separately
            // (zero every variant, flag for manual resync) instead of going through the normal
            // per-variant update/archive flow below.
            const resyncProductUuids = new Set(
                Array.from(productStockStatus.entries())
                    .filter(([, status]) => status.hasUnmatchedSku)
                    .map(([productUuid]) => productUuid),
            );
            const normalChanges = changes.filter((c) => !resyncProductUuids.has(c.productUuid));

            // Step 4: Apply stock updates to Camion
            await this.applyStockUpdates(normalChanges);

            // Step 4b: Zero out and flag products whose 1688 SKUs no longer match ours
            await this.applyResyncUpdates(resyncProductUuids, productMap);

            // Step 5: Update product statuses (archive out-of-stock, reactivate back-in-stock)
            await this.updateProductStatuses(normalChanges, productStockStatus);

            // Step 6: Log changes and create summary
            const summary = this.createSummary(changes);

            const duration = Date.now() - startTime;
            this.logger.log(
                `Stock check completed in ${duration}ms: ${summary.totalChecked} products checked, ` +
                `${summary.outOfStock} out of stock, ${summary.backInStock} back in stock`,
            );

            return summary;
        } catch (error: any) {
            this.logger.error(`Stock check failed: ${error.message}`, error.stack);
            throw error;
        } finally {
            this.isRunning = false;
        }
    }

    /**
     * Fetch all products from Camion API with pagination
     */
    private async fetchAllProducts(): Promise<CamionProduct[]> {
        const allProducts: CamionProduct[] = [];
        const pageSize = 24;
        let page = 1;

        while (true) {
            try {
                const products = await this.camionApi.getProducts(page, pageSize);

                const filtered = products.filter((p) => {
                    if (p.procurementId) {
                        return true;
                    } else {
                        return false;
                    }
                });

                allProducts.push(...filtered);

                this.logger.log(
                    `Fetched page ${page}: ${products.length} products`
                );

                if (products.length < pageSize) {
                    break;
                }

                page++;
            } catch (error: any) {
                this.logger.error(`Failed to fetch products page ${page}: ${error.message}`);
                throw error;
            }
        }

        return allProducts;
    }

    /**
     * Map products by their procurement ID for quick lookup
     */
    private mapProductsByProcurementId(
        products: CamionProduct[],
    ): Map<string, CamionProduct> {
        const map = new Map<string, CamionProduct>();
        for (const product of products) {
            if (product.procurementId) {
                map.set(product.procurementId, product);
            }
        }
        return map;
    }

    /**
     * Check availability for all products from 1688
     */
    private async checkAllProductsAvailability(
        productMap: Map<string, CamionProduct>,
    ): Promise<Map<string, { available: boolean; stock: number, productDetail: GulltransProductDetail | null }>> {
        const procurementIds = Array.from(productMap.keys());
        const results = new Map<string, { available: boolean; stock: number, productDetail: GulltransProductDetail | null; }>();

        this.logger.log(`Checking availability for ${procurementIds.length} products`);

        // Check in batches to avoid rate limiting
        const batches = this.chunkArray(procurementIds, this.batchSize);
        let processed = 0;

        for (const batch of batches) {
            const batchPromises = batch.map(async (procurementId) => {
                try {
                    const result = await this.gulltransApi.checkProductAvailability(
                        procurementId,
                    );
                    if (result) {
                        results.set(procurementId, {
                            available: result.available,
                            stock: result.stock,
                            productDetail: result.productDetail
                        });
                    }
                } catch (error: any) {
                    this.logger.error(`Failed to check ${procurementId}: ${error.message}`);
                    results.set(procurementId, {
                        available: false,
                        stock: 0,
                        productDetail: null,
                    });
                }
            });

            await Promise.all(batchPromises);
            processed += batch.length;

            this.logger.log(
                `Checked ${processed}/${procurementIds.length} products - ` +
                `${results.size} results so far`,
            );

            // Delay between batches to respect rate limits
            if (batches.indexOf(batch) < batches.length - 1) {
                await this.delay(this.configService.get<number>('RATE_LIMIT_DELAY', 1000));
            }
        }
        
        return results;
    }

    /**
       * Process availability results and detect stock changes
       * Now handles per-variant SKU matching correctly
       */
    private async processAvailabilityResults(
        availabilityResults: Map<string, { available: boolean; stock: number, productDetail: GulltransProductDetail | null }>,
        productMap: Map<string, CamionProduct>,
    ): Promise<{ changes: StockChange[]; productStockStatus: Map<string, { total: number; outOfStock: number; hasUnmatchedSku: boolean }> }> {
        const changes: StockChange[] = [];
        // Tracks, per product, how many variants exist vs. how many are out of stock on 1688,
        // and whether any variant failed to match a 1688 SKU at all (stale mapping, needs resync).
        const productStockStatus = new Map<string, { total: number; outOfStock: number; hasUnmatchedSku: boolean }>();

        const trackProductStockStatus = (
            productUuid: string,
            isOutOfStock: boolean,
            isUnmatchedSku: boolean = false,
        ) => {
            const status = productStockStatus.get(productUuid) || { total: 0, outOfStock: 0, hasUnmatchedSku: false };
            status.total += 1;
            if (isOutOfStock) {
                status.outOfStock += 1;
            }
            if (isUnmatchedSku) {
                status.hasUnmatchedSku = true;
            }
            productStockStatus.set(productUuid, status);
        };

        for (const [procurementId, result] of availabilityResults) {
            const product = productMap.get(procurementId);
            if (!product) {
                this.logger.warn(`Product not found for procurement ID: ${procurementId}`);
                continue;
            }

            if (product.variants.length === 0) {
                this.logger.log(`Detected ${product.variants.length} product variants`);

                const change = {
                    productUuid: product.uuid,
                    variantUuid: null,
                    productSku: null,
                    procurementId: product.procurementId,
                    previousStock: 0,
                    currentStock: 0,
                    changeType: StockChangeType.N0_VARIANT,
                    metadata: {
                        procurementId: product.procurementId,
                        variantSku: null,
                        variantSkuMeta: null,
                        currentStockInSystem: 0,
                        stockFrom1688: 0,
                        isAvailableFrom1688: false,
                        productTitle: product.titleEn || product.slug,
                    },
                    shouldNotify: false,
                };
                changes.push(change);
                await this.saveStockHistory(change);
            }

            // Check each variant of the product
            for (const variant of product.variants || []) {

                if (!variant.inventoryItem?.levels?.length) {

                    // No inventory levels means no stock
                    trackProductStockStatus(product.uuid, true);

                    const change = this.detectStockChangeForVariant(
                        product,
                        variant,
                        0,
                        false,
                        0,
                    );
                    if (change) {
                        changes.push(change);
                        await this.saveStockHistory(change);
                    }
                    continue;
                }

                // Calculate current total stock across all warehouses
                const currentStock = variant.inventoryItem.levels.reduce(
                    (sum, level) => sum + (level.quantity || 0),
                    0,
                );

                // Get the 1688 stock for this specific variant
                // We need to map the 1688 SKU to our variant
                const variantAvailability = await this.getVariantStockFrom1688(
                    procurementId,
                    variant,
                    result.productDetail?.productSkuInfos || [],
                );

                const isAvailableFrom1688 = variantAvailability?.available || false;
                const stockFrom1688 = variantAvailability?.stock || 0;

                trackProductStockStatus(
                    product.uuid,
                    !isAvailableFrom1688 || stockFrom1688 === 0,
                    !variantAvailability?.matched,
                );

                // Detect changes based on 1688 availability for this specific variant
                const change = this.detectStockChangeForVariant(
                    product,
                    variant,
                    currentStock,
                    isAvailableFrom1688,
                    stockFrom1688,
                );

                if (change) {
                    changes.push(change);
                    await this.saveStockHistory(change);
                }
            }
        }
        console.log("changeschangeschangeschanges", changes);
        
        this.logger.log(`Detected ${changes.length} stock changes`);
        return { changes, productStockStatus };
    }

    /**
   * Get stock for a specific variant from 1688
   * This properly matches the variant SKU with the 1688 SKU
   */
    private async getVariantStockFrom1688(
        procurementId: string,
        variant: CamionVariant,
        skus: GulltransSkuInfo[],
    ): Promise<{ available: boolean; stock: number; specId: string | null; matched: boolean }> {
        try {
            // Use the SKU-specific check method
            const result = await this.gulltransApi.checkSkuAvailability(
                procurementId,
                skus,
                variant.sku,
                variant.skuMeta,
            );

            if (result.skuInfo) {
                return {
                    available: result.available,
                    stock: result.stock,
                    specId: result.skuInfo.specId,
                    matched: true,
                };
            }

            // No matching SKU on 1688 for this variant - our SKU/spec mapping is stale
            return {
                available: false,
                stock: 0,
                specId: null,
                matched: false,
            };
        } catch (error: any) {
            this.logger.error(
                `Failed to get 1688 stock for variant ${variant.sku}: ${error.message}`
            );
            // A request failure isn't evidence of a stale SKU mapping - don't treat it as unmatched
            return {
                available: false,
                stock: 0,
                specId: null,
                matched: true,
            };
        }
    }

    /**
     * Detect stock change for a specific variant
     */
    private detectStockChangeForVariant(
        product: CamionProduct,
        variant: CamionVariant,
        currentStock: number,
        isAvailableFrom1688: boolean,
        stockFrom1688: number,
    ): StockChange | null {
        let changeType: StockChangeType = StockChangeType.NO_CHANGE;
        let shouldNotify = false;
        const metadata: Record<string, any> = {
            procurementId: product.procurementId,
            variantSku: variant.sku,
            variantSkuMeta: variant.skuMeta,
            currentStockInSystem: currentStock,
            stockFrom1688: stockFrom1688,
            isAvailableFrom1688: isAvailableFrom1688,
            productTitle: product.titleEn || product.slug,
        };

        // Determine change type based on 1688 availability for this specific variant
        if (!isAvailableFrom1688 || stockFrom1688 === 0) {
            // This specific SKU is out of stock on 1688
            if (currentStock > 0 || product.status === 'active') {
                changeType = StockChangeType.OUT_OF_STOCK;
                shouldNotify = true;
                metadata.reason = 'Variant unavailable from vendor (out of stock)';
                metadata.specId = variant.skuMeta?.spec_id || 'unknown';
            }
        } else if (currentStock === 0 && stockFrom1688 > 0) {
            // This specific SKU was out of stock but now available
            changeType = StockChangeType.BACK_IN_STOCK;
            shouldNotify = true;
            metadata.reason = 'Variant available from vendor (back in stock)';
            metadata.specId = variant.skuMeta?.spec_id || 'unknown';
        } else if (stockFrom1688 < currentStock) {
            // Stock decreased but not completely out
            changeType = StockChangeType.STOCK_DECREASED;
            metadata.stockDecrease = currentStock - stockFrom1688;
            metadata.reason = `Stock decreased from ${currentStock} to ${stockFrom1688}`;
        } else if (stockFrom1688 > currentStock) {
            // Stock increased
            changeType = StockChangeType.STOCK_INCREASED;
            metadata.stockIncrease = stockFrom1688 - currentStock;
            metadata.reason = `Stock increased from ${currentStock} to ${stockFrom1688}`;
        }

        // Only return if there's a meaningful change
        if (changeType === StockChangeType.NO_CHANGE) {
            return null;
        }

        return {
            productUuid: product.uuid,
            variantUuid: variant.uuid,
            productSku: variant.sku || product.slug,
            procurementId: product.procurementId,
            previousStock: currentStock,
            currentStock: stockFrom1688,
            changeType,
            metadata,
            shouldNotify,
        };
    }

    /**
     * Detect if there's a stock change and determine the type
     */
    private detectStockChange(
        product: CamionProduct,
        variant: CamionVariant,
        currentStock: number,
        newStock: number,
        availabilityResult: { available: boolean; stock: number },
    ): StockChange | null {
        let changeType: StockChangeType = StockChangeType.NO_CHANGE;
        let shouldNotify = false;
        const metadata: Record<string, any> = {
            procurementId: product.procurementId,
            availabilityFrom1688: availabilityResult.available,
            stockFrom1688: availabilityResult.stock,
            productTitle: product.titleEn || product.slug,
            variantSku: variant.sku,
        };

        // Determine change type based on 1688 availability
        if (!availabilityResult.available || availabilityResult.stock === 0) {
            // Product is out of stock on 1688
            if (currentStock > 0 || product.status === 'active') {
                changeType = StockChangeType.OUT_OF_STOCK;
                shouldNotify = true;
                metadata.reason = 'Product unavailable from vendor (out of stock)';
                metadata.affectedWarehouses = variant.inventoryItem?.levels?.map(l => ({
                    warehouse: l.warehouse?.name || 'Unknown',
                    quantity: l.quantity,
                })) || [];
            }
        } else if (currentStock === 0 && availabilityResult.stock > 0) {
            // Product was out of stock but now available
            changeType = StockChangeType.BACK_IN_STOCK;
            shouldNotify = true;
            metadata.reason = 'Product available from vendor (back in stock)';
        } else if (availabilityResult.stock < currentStock) {
            // Stock decreased but not completely out
            changeType = StockChangeType.STOCK_DECREASED;
            metadata.stockDecrease = currentStock - availabilityResult.stock;
            metadata.reason = `Stock decreased from ${currentStock} to ${availabilityResult.stock}`;
        } else if (availabilityResult.stock > currentStock) {
            // Stock increased
            changeType = StockChangeType.STOCK_INCREASED;
            metadata.stockIncrease = availabilityResult.stock - currentStock;
            metadata.reason = `Stock increased from ${currentStock} to ${availabilityResult.stock}`;
        }

        // Only return if there's a meaningful change
        if (changeType === StockChangeType.NO_CHANGE) {
            return null;
        }

        return {
            productUuid: product.uuid,
            variantUuid: variant.uuid,
            productSku: variant.sku || product.slug,
            procurementId: product.procurementId,
            previousStock: currentStock,
            currentStock: availabilityResult.stock,
            changeType,
            metadata,
            shouldNotify,
        };
    }

    /**
     * Apply stock updates to Camion backend
     */
    private async applyStockUpdates(changes: StockChange[]): Promise<void> {
        const updates = changes
            .filter((c) => ![StockChangeType.NO_CHANGE, StockChangeType.N0_VARIANT].includes(c.changeType))
            .map((change) => {
                // Determine the target stock based on change type
                let newQuantity = change.previousStock;

                if (change.changeType === StockChangeType.OUT_OF_STOCK) {
                    newQuantity = 0;
                } else if (change.changeType === StockChangeType.BACK_IN_STOCK) {
                    newQuantity = Math.max(change.currentStock, 1);
                } else if (change.changeType === StockChangeType.STOCK_DECREASED) {
                    newQuantity = Math.max(change.currentStock, 0);
                } else if (change.changeType === StockChangeType.STOCK_INCREASED) {
                    newQuantity = change.currentStock;
                }

                return {
                    variantUuid: change.variantUuid,
                    quantity: newQuantity,
                    warehouseUuid: this.configService.get<string>('DEFAULT_WAREHOUSE_UUID') || '',
                };
            });

        if (updates.length === 0) {
            this.logger.log('No stock updates to apply');
            return;
        }

        // Apply updates in batches
        const batchSize = 20;
        const batches = this.chunkArray(updates, batchSize);
        let successCount = 0;
        let failureCount = 0;

        for (const batch of batches) {
            try {
                await this.camionApi.bulkUpdateStock({ updates: batch });
                successCount += batch.length;
                this.logger.log(`Applied stock updates for ${batch.length} variants`);
            } catch (error: any) {
                failureCount += batch.length;
                this.logger.error(`Failed to apply batch stock update: ${error.message}`);
                // Continue with next batch
            }
        }

        this.logger.log(
            `Stock updates complete: ${successCount} succeeded, ${failureCount} failed`,
        );
    }

    /**
     * Zero out every variant and flag for manual resync any product where at least one
     * variant no longer matches a 1688 SKU - its SKU/spec mapping is stale and per-variant
     * stock data for the whole product can't be trusted until someone re-maps it.
     */
    private async applyResyncUpdates(
        resyncProductUuids: Set<string>,
        productMap: Map<string, CamionProduct>,
    ): Promise<void> {
        if (resyncProductUuids.size === 0) {
            return;
        }

        const resyncProducts = Array.from(productMap.values()).filter((product) =>
            resyncProductUuids.has(product.uuid),
        );

        const warehouseUuid = this.configService.get<string>('DEFAULT_WAREHOUSE_UUID') || '';
        const updates = resyncProducts.flatMap((product) =>
            product.variants.map((variant) => ({
                variantUuid: variant.uuid,
                quantity: 0,
                warehouseUuid,
            })),
        );

        if (updates.length > 0) {
            const batches = this.chunkArray(updates, 20);
            for (const batch of batches) {
                try {
                    await this.camionApi.bulkUpdateStock({ updates: batch });
                    this.logger.log(`Zeroed ${batch.length} variants pending resync`);
                } catch (error: any) {
                    this.logger.error(`Failed to zero out variants pending resync: ${error.message}`);
                }
            }
        }

        for (const product of resyncProducts) {
            try {
                await this.camionApi.updateResyncStatus(product.uuid, true);
                this.logger.log(
                    `🔄 Flagged product ${product.uuid} (${product.titleEn || product.slug}) for resync - 1688 SKUs no longer match`,
                );
            } catch (error: any) {
                this.logger.error(
                    `Failed to flag product ${product.uuid} for resync: ${error.message}`,
                );
            }
        }
    }

    /**
     * Update product statuses based on stock changes
     */
    private async updateProductStatuses(
        changes: StockChange[],
        productStockStatus: Map<string, { total: number; outOfStock: number; hasUnmatchedSku: boolean }>,
    ): Promise<void> {
        // Only archive a product when EVERY one of its variants is out of stock on 1688.
        // If some variants still have stock, leave the product active - the individual
        // out-of-stock variants already had their quantity zeroed out in applyStockUpdates.
        const fullyOutOfStockProductUuids = new Set(
            Array.from(productStockStatus.entries())
                .filter(([, status]) => status.total > 0 && status.outOfStock === status.total)
                .map(([productUuid]) => productUuid),
        );

        const outOfStockProducts = changes.filter(
            (c) => c.changeType === StockChangeType.OUT_OF_STOCK && fullyOutOfStockProductUuids.has(c.productUuid),
        );

        const archivedProductUuids = new Set<string>();
        for (const change of outOfStockProducts) {
            if (archivedProductUuids.has(change.productUuid)) {
                continue;
            }
            archivedProductUuids.add(change.productUuid);

            try {
                await this.camionApi.updateProcurementStatus(
                    change.productUuid,
                    false,
                );
                await this.camionApi.updateProductStatus(
                    change.productUuid,
                    'archived',
                );
                this.logger.log(
                    `✅ Marked product ${change.productUuid} (${change.productSku}) - Out of stock`,
                );
            } catch (error: any) {
                this.logger.error(
                    `❌ Failed to marked product out of stock ${change.productUuid}: ${error.message}`,
                );
            }
        }

        const noVariantProducts = changes.filter(
            (c) => c.changeType === StockChangeType.N0_VARIANT,
        );

        for (const change of noVariantProducts) {
            try {
                await this.camionApi.updateProductStatus(
                    change.productUuid,
                    "draft",
                );
                this.logger.log(
                    `✅ Marked product ${change.productUuid} (${change.productSku}) - inactive`,
                );
            } catch (error: any) {
                this.logger.error(
                    `❌ Failed to marked product inactive ${change.productUuid}: ${error.message}`,
                );
            }
        }
    }

    /**
     * Save stock change to history
     */
    private async saveStockHistory(change: StockChange): Promise<void> {
        try {
            const history = new StockHistory();
            history.uuid = crypto.randomUUID();
            history.productUuid = change.productUuid;
            history.variantUuid = change.variantUuid;
            history.productSku = change.productSku;
            history.procurementId = change.procurementId || '';
            history.previousStock = change.previousStock;
            history.currentStock = change.currentStock;
            history.changeType = change.changeType;
            history.metadata = change.metadata;
            history.errorMessage = change.errorMessage || '';
            history.notificationSent = false;

            await this.stockHistoryRepository.save(history);
        } catch (error: any) {
            console.log('Failed to save stock history:', error);
            this.logger.error(`Failed to save stock history: ${error.message}`);
        }
    }

    /**
     * Create summary of all changes
     */
    private createSummary(changes: StockChange[]): StockChangeSummary {
        const outOfStock = changes.filter(
            (c) => c.changeType === StockChangeType.OUT_OF_STOCK,
        ).length;
        const backInStock = changes.filter(
            (c) => c.changeType === StockChangeType.BACK_IN_STOCK,
        ).length;
        const stockDecreased = changes.filter(
            (c) => c.changeType === StockChangeType.STOCK_DECREASED,
        ).length;
        const stockIncreased = changes.filter(
            (c) => c.changeType === StockChangeType.STOCK_INCREASED,
        ).length;
        const errors = changes.filter((c) => c.errorMessage).length;

        return {
            totalChecked: changes.length,
            outOfStock,
            backInStock,
            stockDecreased,
            stockIncreased,
            errors,
            changes,
        };
    }

    /**
     * Send notifications for significant changes
     */
    private async sendNotifications(changes: StockChange[]): Promise<void> {
        const notifiableChanges = changes.filter(
            (c) => c.shouldNotify && c.changeType !== StockChangeType.NO_CHANGE,
        );

        if (notifiableChanges.length === 0) return;

        // Log all changes
        await this.stockLogger.logStockChanges(notifiableChanges);

        // Group by change type
        const outOfStock = notifiableChanges.filter(
            (c) => c.changeType === StockChangeType.OUT_OF_STOCK,
        );
        const backInStock = notifiableChanges.filter(
            (c) => c.changeType === StockChangeType.BACK_IN_STOCK,
        );

        // Log warnings for out-of-stock products
        if (outOfStock.length > 0) {
            const productList = outOfStock
                .map((c) => `${c.productSku} (${c.procurementId})`)
                .join(', ');
            this.logger.warn(
                `⚠️ ${outOfStock.length} products are out of stock: ${productList}`,
            );
        }

        // Log info for back-in-stock products
        if (backInStock.length > 0) {
            const productList = backInStock
                .map((c) => `${c.productSku} (${c.procurementId})`)
                .join(', ');
            this.logger.log(
                `✅ ${backInStock.length} products are back in stock: ${productList}`,
            );
        }

        // TODO: Integrate with notification system (email, Slack, etc.)
        // This could be extended to send emails or Slack messages
    }

    /**
     * Utility: Chunk array into smaller arrays
     */
    private chunkArray<T>(array: T[], size: number): T[][] {
        const chunks: T[][] = [];
        for (let i = 0; i < array.length; i += size) {
            chunks.push(array.slice(i, i + size));
        }
        return chunks;
    }

    /**
     * Utility: Delay execution
     */
    private delay(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    /**
     * Get stock check history
     */
    async getStockHistory(
        productUuid?: string,
        days: number = 7,
    ): Promise<StockHistory[]> {
        const query = this.stockHistoryRepository
            .createQueryBuilder('stock_history')
            .where('stock_history.checkedAt > :cutoff', {
                cutoff: new Date(Date.now() - days * 24 * 60 * 60 * 1000),
            })
            .orderBy('stock_history.checkedAt', 'DESC');

        if (productUuid) {
            query.andWhere('stock_history.productUuid = :productUuid', { productUuid });
        }

        return query.getMany();
    }

    /**
     * Get summary statistics
     */
    async getStatistics(days: number = 7): Promise<{
        totalChecks: number;
        outOfStockEvents: number;
        backInStockEvents: number;
        averageStockLevel: number;
        productsWithIssues: string[];
    }> {
        const history = await this.getStockHistory(undefined, days);

        const outOfStockEvents = history.filter(
            (h) => h.changeType === StockChangeType.OUT_OF_STOCK,
        ).length;

        const backInStockEvents = history.filter(
            (h) => h.changeType === StockChangeType.BACK_IN_STOCK,
        ).length;

        const productsWithIssues = [...new Set(
            history
                .filter((h) =>
                    h.changeType === StockChangeType.OUT_OF_STOCK ||
                    h.changeType === StockChangeType.STOCK_DECREASED
                )
                .map((h) => h.productUuid),
        )];

        // Calculate average stock (only for products with stock)
        const stockEntries = history
            .filter((h) => h.currentStock > 0)
            .map((h) => h.currentStock);

        const averageStockLevel = stockEntries.length > 0
            ? stockEntries.reduce((a, b) => a + b, 0) / stockEntries.length
            : 0;

        return {
            totalChecks: history.length,
            outOfStockEvents,
            backInStockEvents,
            averageStockLevel: Math.round(averageStockLevel),
            productsWithIssues,
        };
    }
}