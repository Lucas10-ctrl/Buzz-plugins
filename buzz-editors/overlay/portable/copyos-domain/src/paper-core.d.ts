/** Paper publishes the core declaration without its runtime file extension. */
declare module 'paper/dist/paper-core.js' {
  import core from 'paper/dist/paper-core'
  export default core
}

/** Runtime SVG serializer omitted from Paper's generated getter declarations. */
declare namespace paper {
  /** Precision-controlled serializer supplied by the installed Paper runtime. */
  interface PathItem {
    /** Serialize without the five-decimal default used by the pathData getter.
     * @param matrix - Additional output transform; null retains local coordinates.
     * @param precision - Maximum decimal digits retained in coordinates.
     * @returns SVG path commands including all compound contours.
     */
    getPathData(matrix: Matrix | null, precision: number): string
  }
}
