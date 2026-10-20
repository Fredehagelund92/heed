/**
 * What not to conclude, for the demo items whose contributor wrote more than the default
 * "cause not proven" (FR-104), by title. The mock serves these words and the demo seed stores
 * them, so Try it and an agent's reply show the same caveat against either. A leaf module: the
 * mock reads it without loading the fixture library.
 */
export const demoCaveats: Readonly<Record<string, string>> = {
  'Payment provider delays order data in Poland':
    'Low orders in Poland for these days do not mean that customers ordered less. Wait until the data catches up before comparing Poland with other markets.',
}
