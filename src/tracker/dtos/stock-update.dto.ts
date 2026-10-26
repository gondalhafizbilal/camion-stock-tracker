export class UpdateStockDto {
    variantUuid: string | null;
    quantity: number;
    warehouseUuid: string;
}

export class UpdateProductStatusDto {
    status: 'active' | 'archived' | 'draft';
}

export class BulkStockUpdateDto {
    updates: UpdateStockDto[];
}