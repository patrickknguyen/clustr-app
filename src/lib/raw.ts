// Demo flag: add ?raw to the URL to see the slider before the stability fixes.
// Raw mode skips Procrustes alignment (so UMAP can spin and mirror-flip between blends)
// and re-clusters on every drag tick instead of once on release.
export const RAW =
  typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('raw');
