import { StockChangeType } from "./entities/stock-history.entity";

export interface CamionProduct {
    uuid: string;
    slug: string;
    titleEn: string;
    titleAr: string;
    status: string;
    procurementId: string | null;
    variants: CamionVariant[];
    shopId?: string;
    shopName?: string;
}

export interface CamionVariant {
    uuid: string;
    sku: string;
    skuMeta?: Record<string, any>;
    cost: {
        amount: number;
        currencyCode: string;
    };
    inventoryItem: {
        uuid: string;
        levels: {
            quantity: number;
            warehouse: {
                uuid: string;
                name: string;
            };
        }[];
    };
}

export interface CamionApiResponse<T> {
    data: T[];
    pagination?: {
        totalProducts: number;
        totalPage: number;
        page_size: number;
        currentPage: number;
    };
}

export interface StockChange {
    productUuid: string;
    variantUuid: string | null;
    productSku: string | null;
    procurementId: string | null;
    previousStock: number;
    currentStock: number;
    changeType: StockChangeType;
    metadata: Record<string, any>;
    errorMessage?: string;
    shouldNotify: boolean;
}

export interface StockChangeSummary {
    totalChecked: number;
    outOfStock: number;
    backInStock: number;
    stockDecreased: number;
    stockIncreased: number;
    errors: number;
    changes: StockChange[];
}

export interface GulltransSkuInfo {
    skuId: number;
    specId: string;
    amountOnSale: number;
    price: string;
    skuAttributes: Array<{
        attributeId: number;
        attributeName: string;
        value: string;
        skuImageUrl?: string;
    }>;
}

export interface GulltransProductDetail {
    offerId: number;
    subject: string;
    subjectTrans?: string;
    productSkuInfos: GulltransSkuInfo[];
    productSaleInfo?: {
        amountOnSale: number;
    };
    minOrderQuantity: number;
    isOnePsale: boolean;
}

export interface GulltransAvailabilityResponse {
    ret: number;
    msg: string;
    data: {
        result: GulltransProductDetail;
    };
}

export interface SkuAvailability {
    specId: string;          // 1688 spec ID
    skuId: number;           // 1688 SKU ID
    available: boolean;
    stock: number;
    price: string;
    attributes: Array<{
        name: string;
        value: string;
    }>;
}

export interface GullTransResponse {
    available: boolean;
    stock: number;
}

export interface GullTransSkuResponse {
    available: boolean;
    stock: number;
    skuInfo: SkuAvailability | null;
}

export interface GullTransProductResponse {
    available: boolean;
    stock: number;
    productDetail: GulltransProductDetail | null;
}