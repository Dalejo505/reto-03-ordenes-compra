// Parámetros de negocio. Cambiar una tolerancia o una constante SAP se hace aquí,
// sin tocar el servidor ni el ciclo del agente.
export const CONFIG = {
  sociedad: "1000",
  organizacionCompras: "1000",
  /** RC5: diferencia máxima permitida entre cotización y solicitud */
  toleranciaCotizacion: 0.02,
  /** RC10: diferencia máxima entre cantidad × valor_unitario y valor_total */
  toleranciaAritmetica: 1,
  /** Límite SAP del texto breve de posición */
  maxDescripcion: 40,
  /** Primera posición y paso entre posiciones */
  posicionInicial: 10,
  /** Primer número de OC del SAP simulado */
  primerNumeroOc: 4500000001,
  monedasSoportadas: ["COP", "USD"] as const,
} as const
