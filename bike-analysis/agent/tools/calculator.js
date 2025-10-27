const { create, all } = require('mathjs');
const dayjs = require('dayjs');

const math = create(all, {
  number: 'number'
});

const SAFE_EXPR_REGEX = /^[0-9+\-*/().\s]+$/;

function createCalculator() {
  return async function calculatorTool(input) {
    const ts = dayjs().toISOString();
    const expression = input?.expression;

    if (!expression || typeof expression !== 'string') {
      return { success: false, error: 'Expression must be provided.', ts };
    }

    if (!SAFE_EXPR_REGEX.test(expression)) {
      return { success: false, error: 'Expression contains unsupported characters.', ts };
    }

    try {
      const value = math.evaluate(expression);
      return {
        success: true,
        data: {
          value,
          units: input.units
        },
        ts
      };
    } catch (error) {
      return {
        success: false,
        error: error.message || 'Failed to evaluate expression.',
        ts
      };
    }
  };
}

module.exports = createCalculator;
