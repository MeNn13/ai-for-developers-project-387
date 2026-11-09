# Changelog

## [0.3.0](https://github.com/MeNn13/ai-for-developers-project-386/compare/v0.2.1...v0.3.0) (2026-11-08)


### Features

* **api:** generate server models and use health DTO ([#60](https://github.com/MeNn13/ai-for-developers-project-386/issues/60)) ([3ee5a99](https://github.com/MeNn13/ai-for-developers-project-386/commit/3ee5a99607d37e1dcd2324e4786b4a9c4b708828))
* **api:** integrate generated server transport models ([779780b](https://github.com/MeNn13/ai-for-developers-project-386/commit/779780b80f6bcdacbc29f579182bcebc2d91bfd6))
* **api:** use generated booking and meeting models ([#62](https://github.com/MeNn13/ai-for-developers-project-386/issues/62)) ([53eb9b8](https://github.com/MeNn13/ai-for-developers-project-386/commit/53eb9b8b341eb36507f3ac3e480dab5a91e1249d))
* **api:** use generated meeting type and problem models ([#61](https://github.com/MeNn13/ai-for-developers-project-386/issues/61)) ([263134e](https://github.com/MeNn13/ai-for-developers-project-386/commit/263134e7982eff787f5f94090e14e706bd06f01a))
* **api:** use generated slot responses and complete conformance ([#63](https://github.com/MeNn13/ai-for-developers-project-386/issues/63)) ([fae3ed6](https://github.com/MeNn13/ai-for-developers-project-386/commit/fae3ed69fd81d708c752fd8223a6e5e1207e7707))


### Bug Fixes

* apply agent workflow retro improvements ([b52e685](https://github.com/MeNn13/ai-for-developers-project-386/commit/b52e68591be1549eecd3591d11cc30fdb9ba67cf))
* apply agent workflow retro improvements ([#70](https://github.com/MeNn13/ai-for-developers-project-386/issues/70)) ([e613b41](https://github.com/MeNn13/ai-for-developers-project-386/commit/e613b41ad681e03410d5178f707bbccf97d83c2a))
* **ci:** isolate script fixtures from git hook environment ([#70](https://github.com/MeNn13/ai-for-developers-project-386/issues/70)) ([291319e](https://github.com/MeNn13/ai-for-developers-project-386/commit/291319e660de4c7ac98ed994e9561cf01cfeab61))
* match Windows agent command permissions ([df9d749](https://github.com/MeNn13/ai-for-developers-project-386/commit/df9d749b28cc871e0bed8c14f2799bf99d260ba3))
* match Windows agent command permissions ([#66](https://github.com/MeNn13/ai-for-developers-project-386/issues/66)) ([ec440b3](https://github.com/MeNn13/ai-for-developers-project-386/commit/ec440b3e621f5c61f1eb621a7501013f67f2cc37))
* validate patched server model generation ([11b3692](https://github.com/MeNn13/ai-for-developers-project-386/commit/11b3692a1a482d01646635c8eb4e0bc646278eae))
* validate patched server model generation ([#56](https://github.com/MeNn13/ai-for-developers-project-386/issues/56)) ([56d768c](https://github.com/MeNn13/ai-for-developers-project-386/commit/56d768cb9230e4bfb16c276289a22b2d970172a0))

## [0.2.1](https://github.com/MeNn13/ai-for-developers-project-386/compare/v0.2.0...v0.2.1) (2026-10-31)


### Bug Fixes

* **ci:** exclude bot-owned changelog from linters ([0b54efc](https://github.com/MeNn13/ai-for-developers-project-386/commit/0b54efcb3bbd210d45a016a81f05217606a7c5e2))

## [0.2.0](https://github.com/MeNn13/ai-for-developers-project-386/compare/v0.1.0...v0.2.0) (2026-10-30)

### Features

- **api:** add meeting booking ([#27](https://github.com/MeNn13/ai-for-developers-project-386/issues/27)) ([e6ca8ac](https://github.com/MeNn13/ai-for-developers-project-386/commit/e6ca8ac2f277bfbd6b83c2edd1d83599a7e37ee8))
- **api:** add meeting type endpoints ([#24](https://github.com/MeNn13/ai-for-developers-project-386/issues/24)) ([e418d21](https://github.com/MeNn13/ai-for-developers-project-386/commit/e418d2106b5982355435562c18359e2f38de4b20))
- **api:** add slots endpoint ([#25](https://github.com/MeNn13/ai-for-developers-project-386/issues/25)) ([6f08d12](https://github.com/MeNn13/ai-for-developers-project-386/commit/6f08d1269490d815a55eb8f15e05b191d3035dac))
- **api:** serve the built frontend from the web root ([082229b](https://github.com/MeNn13/ai-for-developers-project-386/commit/082229beb2116fb1b9efe1b9c032b1f63a07f579))
- **api:** validate meeting types and report problems ([#24](https://github.com/MeNn13/ai-for-developers-project-386/issues/24)) ([abefe83](https://github.com/MeNn13/ai-for-developers-project-386/commit/abefe83bfa375195d588ef0eb10ffb70b4053d8b))
- booking calendar service (spec [#23](https://github.com/MeNn13/ai-for-developers-project-386/issues/23)) ([7bb69a1](https://github.com/MeNn13/ai-for-developers-project-386/commit/7bb69a108f57ad7017819e73d93933903bf6a86a))
- **ci:** block breaking changes to the api contract ([899546b](https://github.com/MeNn13/ai-for-developers-project-386/commit/899546be11ed6a1aaa733913704485539c3164c8))
- **ci:** check markdown and links ([07c7e31](https://github.com/MeNn13/ai-for-developers-project-386/commit/07c7e31a58cfef2c4a427cb747e267731033a241))
- **ci:** enforce conventional commits in ci ([0c20812](https://github.com/MeNn13/ai-for-developers-project-386/commit/0c20812f316ce752ad09cc221c5a515475a44811))
- **ci:** fail when the generated contract or client is stale ([a76f2f2](https://github.com/MeNn13/ai-for-developers-project-386/commit/a76f2f23440eadecd5a096eec8fa35b1611ea855))
- **ci:** lint every workflow and action in the repository ([527cfd6](https://github.com/MeNn13/ai-for-developers-project-386/commit/527cfd6e7fdc7b1a6d0d3155b54db5db38397216))
- **ci:** lint the agent instructions ([98f91c4](https://github.com/MeNn13/ai-for-developers-project-386/commit/98f91c4d756e2d3a7ed210739c9127dc49c03ea7))
- **ci:** scan for committed secrets ([509a68a](https://github.com/MeNn13/ai-for-developers-project-386/commit/509a68a15c135629e3b69fc90f55261ec5bed5c9))
- **ci:** scan lockfiles for known vulnerabilities ([31ac1c6](https://github.com/MeNn13/ai-for-developers-project-386/commit/31ac1c622af64d20795f45e30b2f4fd8e8d94505))
- **contract:** add meeting booking to the contract ([#27](https://github.com/MeNn13/ai-for-developers-project-386/issues/27)) ([dac87cc](https://github.com/MeNn13/ai-for-developers-project-386/commit/dac87ccbc7c7df2b45699008bcc25e3dc63bf140))
- **contract:** describe meeting types and problem details ([#24](https://github.com/MeNn13/ai-for-developers-project-386/issues/24)) ([1a06ff5](https://github.com/MeNn13/ai-for-developers-project-386/commit/1a06ff57e849f27ff735e44a8cf84275ed938f32))
- **contract:** describe slots endpoint ([#25](https://github.com/MeNn13/ai-for-developers-project-386/issues/25)) ([aa1d226](https://github.com/MeNn13/ai-for-developers-project-386/commit/aa1d22659b914e1f36accfb84e2ce4d52c10ca14))
- **contract:** lint the generated openapi spec ([df8c746](https://github.com/MeNn13/ai-for-developers-project-386/commit/df8c746c1ba327ef8ed03d6552adf52d22433e0a))
- keep dependency versions consistent across workspaces ([10912ef](https://github.com/MeNn13/ai-for-developers-project-386/commit/10912eff9e16792271fa3d37f90569a3973890cd))
- ship the project as one container image ([20092d9](https://github.com/MeNn13/ai-for-developers-project-386/commit/20092d9e626bee6346adc34f7d72dc9c0a7ddb2d))
- ship the project as one container image ([3324eb9](https://github.com/MeNn13/ai-for-developers-project-386/commit/3324eb9fe058cac546bda34eb80bbf305e0e817c))
- **web:** add guest booking with confirmation ([#27](https://github.com/MeNn13/ai-for-developers-project-386/issues/27)) ([a9d8d92](https://github.com/MeNn13/ai-for-developers-project-386/commit/a9d8d920f7a32ce2b632817095bdedf308324a77))
- **web:** add owner meeting type form and list ([#24](https://github.com/MeNn13/ai-for-developers-project-386/issues/24)) ([18d445b](https://github.com/MeNn13/ai-for-developers-project-386/commit/18d445b9e3e61ddd0def45f9088880ad6699eb97))
- **web:** add the main page with header navigation ([f211ce9](https://github.com/MeNn13/ai-for-developers-project-386/commit/f211ce9c681125f82fb76b09c6018bf71c28f28f))
- **web:** add the main page with header navigation ([360e974](https://github.com/MeNn13/ai-for-developers-project-386/commit/360e9743a56c6b33583eadfa219917d2241b894d))
- **web:** detect unused files, exports and dependencies ([e38d1e6](https://github.com/MeNn13/ai-for-developers-project-386/commit/e38d1e6d62857fa61cf472f8c74c40c29f1fa2da))
- **web:** recover booking after a slot-not-bookable rejection ([#28](https://github.com/MeNn13/ai-for-developers-project-386/issues/28)) ([93cf645](https://github.com/MeNn13/ai-for-developers-project-386/commit/93cf645ed43b615d041f3eee2212e973ea73c0ee))
- **web:** recover booking after slot rejections ([#28](https://github.com/MeNn13/ai-for-developers-project-386/issues/28)) ([c263f45](https://github.com/MeNn13/ai-for-developers-project-386/commit/c263f45b6651559bb400a7b402cff66583ce8dfd))
- **web:** reset booking to type selection when the type disappeared ([#28](https://github.com/MeNn13/ai-for-developers-project-386/issues/28)) ([8d555f5](https://github.com/MeNn13/ai-for-developers-project-386/commit/8d555f5c25ad1db9fe1a187e7ec1350c4ba9a3a8))
- **web:** reset owner form and return focus to title on success ([#26](https://github.com/MeNn13/ai-for-developers-project-386/issues/26)) ([9415d5c](https://github.com/MeNn13/ai-for-developers-project-386/commit/9415d5c5635af4aa57b369a6a25b072fdc971ca9))
- **web:** retry booking after request failures keeping entered values ([#28](https://github.com/MeNn13/ai-for-developers-project-386/issues/28)) ([a99e97c](https://github.com/MeNn13/ai-for-developers-project-386/commit/a99e97c59733593b9e465492017b29c4a3c27023))
- **web:** show guest name validation errors under the field ([#28](https://github.com/MeNn13/ai-for-developers-project-386/issues/28)) ([9619e36](https://github.com/MeNn13/ai-for-developers-project-386/commit/9619e364db1aad5dba934c28271b09dac370c591))
- **web:** show meeting types and free slots on booking page ([#25](https://github.com/MeNn13/ai-for-developers-project-386/issues/25)) ([51ac1c6](https://github.com/MeNn13/ai-for-developers-project-386/commit/51ac1c6b1367e20317d01e74ba055ad81dab120f))
- **web:** show slots freshness caption with refresh button ([#25](https://github.com/MeNn13/ai-for-developers-project-386/issues/25)) ([e6e39c4](https://github.com/MeNn13/ai-for-developers-project-386/commit/e6e39c4879bd6fbcb47d4d28d723cbeb15dffe89))
- **web:** show upcoming meetings to owner ([#29](https://github.com/MeNn13/ai-for-developers-project-386/issues/29)) ([58be28a](https://github.com/MeNn13/ai-for-developers-project-386/commit/58be28aada3db58c4a76a37f83e0f4dcdb56d86c))
- **web:** suggest meeting type id from title ([#26](https://github.com/MeNn13/ai-for-developers-project-386/issues/26)) ([9323e64](https://github.com/MeNn13/ai-for-developers-project-386/commit/9323e640c6f80be5a3b4fdcaa012c464c549d9fd))
- **web:** transliterate meeting type titles into id slugs ([#26](https://github.com/MeNn13/ai-for-developers-project-386/issues/26)) ([5adc0d6](https://github.com/MeNn13/ai-for-developers-project-386/commit/5adc0d6c96f8dda07c6586156ffed0dfca31c050))
- **web:** validate owner form and lock it during submit ([#26](https://github.com/MeNn13/ai-for-developers-project-386/issues/26)) ([12eaa3b](https://github.com/MeNn13/ai-for-developers-project-386/commit/12eaa3b326f5b7791b9164ca99d3f6d6859fa499))
- **web:** warn about meeting type id collisions ([#26](https://github.com/MeNn13/ai-for-developers-project-386/issues/26)) ([f960aa0](https://github.com/MeNn13/ai-for-developers-project-386/commit/f960aa090faa18ea666812bddda8af384eb99bf6))

### Bug Fixes

- **api:** answer unknown api routes with problem details ([#24](https://github.com/MeNn13/ai-for-developers-project-386/issues/24)) ([030aa62](https://github.com/MeNn13/ai-for-developers-project-386/commit/030aa620cdc14c7eaa7c227bc42be849438f562c))
- **api:** restore utf-8 text in booking atomicity tests ([e18642e](https://github.com/MeNn13/ai-for-developers-project-386/commit/e18642eecbbd813a6c76043030d959e83ec093d7))
- **api:** use glossary term for slot-not-bookable detail ([3587365](https://github.com/MeNn13/ai-for-developers-project-386/commit/35873651980cf1765d81598c36c0992acbafd887))
- **ci:** exempt dependabot commits from commitlint ([acd3bb7](https://github.com/MeNn13/ai-for-developers-project-386/commit/acd3bb79fcb48f88ea0d6de14e5ce1c0d8eb6ba8))
- **ci:** let dependabot pull requests pass the gates ([5152854](https://github.com/MeNn13/ai-for-developers-project-386/commit/5152854ae995d8a818ddfb3e7df222782b279e8a))
- **deps:** patch undici pinned by the typespec openapi emitter ([d7e14d4](https://github.com/MeNn13/ai-for-developers-project-386/commit/d7e14d436c8b18aa5dafeb45affd2f8d67befaa4))
- **web:** enable strict typescript ([80fd71c](https://github.com/MeNn13/ai-for-developers-project-386/commit/80fd71c7317047af608a1c1ecd8b13909c1dc5d8))
