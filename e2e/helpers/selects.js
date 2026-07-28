// The scorecard dropdowns all lead with a disabled placeholder written as
// `<option disabled selected>Choose Division</option>` - no value attribute. Per
// the HTML spec option.value then falls back to the option's text, so a naive
// "first non-empty value" pick returns "Choose Division" and selecting it fails
// with "option being selected is not enabled".

/**
 * Values of the options a user could actually choose: enabled, with a real
 * value, excluding the "0" that means "All" in the filter selects.
 */
async function selectableValues(select) {
  return select.locator('option').evaluateAll(function (els) {
    return els
      .filter(function (e) { return !e.disabled && e.value && e.value !== '0'; })
      .map(function (e) { return e.value; });
  });
}

/** Select the first genuinely selectable option and return its value. */
async function selectFirstReal(select) {
  const values = await selectableValues(select);
  if (!values.length) throw new Error('select has no selectable options');
  await select.selectOption(values[0]);
  return values[0];
}

module.exports = { selectableValues, selectFirstReal };
