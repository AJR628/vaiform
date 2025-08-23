// src/controllers/enhance.controller.js
import { enhancePrompt } from "../services/enhance.service.js";
import { debitCreditsTx } from "../services/credit.service.js";

export async function enhance(req, res) {
  try {
    const { prompt, strength = 0.5 } = req.body;
    const { email } = req.user;

    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    await debitCreditsTx(email, 1);

    const enhancedPrompt = await enhancePrompt(prompt, strength);

    return res.status(200).json({
      success: true,
      enhancedPrompt,
    });
  } catch (error) {
    console.error('Enhance error:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}