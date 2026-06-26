import type { Service } from "./types";
import {
  buildSearchBlob,
  createContentFuse,
  searchContent,
  type SearchableItem,
} from "./fuzzySearch";

export type SearchableService = Service & SearchableItem;

export function toSearchableService(service: Service): SearchableService {
  return {
    ...service,
    searchBlob: buildSearchBlob([
      service.title,
      service.shortTitle,
      service.description,
      service.priceFrom,
      ...service.features,
      service.seo.title,
      service.seo.description,
    ]),
  };
}

export function createServiceFuse(services: SearchableService[]) {
  return createContentFuse(services, [
    { name: "title", weight: 0.25 },
    { name: "shortTitle", weight: 0.15 },
    { name: "description", weight: 0.2 },
    { name: "features", weight: 0.15 },
    { name: "searchBlob", weight: 0.25 },
  ]);
}

export function searchServices(
  fuse: ReturnType<typeof createServiceFuse>,
  services: SearchableService[],
  query: string
) {
  return searchContent(fuse, services, query);
}
