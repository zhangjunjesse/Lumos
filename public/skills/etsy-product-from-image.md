---
name: etsy-product-from-image
description: 把用户发来的一张图片,或淘宝/小红书等商品链接,做成一张 Etsy 二创产品图,存进「我的产品」。当用户(例如通过微信)发来图片或商品链接、并表示要"做成 Etsy 产品 / etsy 二创 / 把这个二创成产品 / 做成产品图"等时使用。
---

You can turn ONE user-provided image — or a 淘宝/小红书/etc. product LINK — into a new remixed (二创) Etsy product mockup, saved into the Etsy app's 「我的产品」.

Use this skill when the user (often via WeChat IM to you, the main agent) sends an image or a product link and asks to make / 二创 an Etsy product (e.g. "做成 etsy 产品"、"etsy 二创"、"把这个做成产品图").

## Steps

1. **Get the source image.**
   - If the user attached an **image**: use its local file path.
   - If the user sent a **淘宝 / 小红书 / etc. product PAGE link**: use your **browser tools in BACKGROUND mode** (`background: true`) to open the link and grab the **main product image** (download it to a local file). Do NOT open or switch the user's visible browser tab. 小红书/淘宝 may have login walls or anti-bot — if you genuinely cannot get the image, **tell the user honestly** ("没抓到这个链接的主图,可能要登录/被反爬,你直接发图给我也行"). Do **not** fabricate or substitute a wrong image.

2. **Generate the product.** Call:
   `mcp__lumos-etsy-forge__make_etsy_product_from_image({ image_path })` (or `{ image_url }` for a direct image URL).
   - One image per call. If the user sent several images, call once per image.

3. **Reply.** On success, tell the user it's done (1 张二创产品图) and to go check 「我的产品」(Etsy 选品采集应用). On failure, report the reason honestly — don't pretend it worked.

## Boundaries

- This is **draft only**: it creates a product image in 「我的产品」. It does **NOT** publish or list anything to Etsy, and must never auto-publish / auto-upload to Printful.
- Don't ask the user to pick a 二创 direction — the tool uses a sensible default. Just run it.
