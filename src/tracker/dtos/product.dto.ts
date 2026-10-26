import { CamionProduct } from "../types";

export class FetchProductsDto {
    status?: string = 'active';
    pageNumber: number = 1;
    itemsPerPage: number = 24;
}

export class ProductListResponseDto {
    products: CamionProduct[];
    pagination: {
        totalProducts: number;
        totalPage: number;
        currentPage: number;
    };
}