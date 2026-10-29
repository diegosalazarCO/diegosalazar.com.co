import { getCollection } from 'astro:content';

export async function getSortedProjects() {
  return (await getCollection('portfolio')).sort((a, b) => a.data.order - b.data.order);
}

export async function getSortedPosts() {
  return (await getCollection('blog')).sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf());
}

export function getPrevNext<T>(items: T[], index: number): { prev: T; next: T } {
  return {
    prev: items[index - 1] ?? items[items.length - 1],
    next: items[index + 1] ?? items[0],
  };
}
