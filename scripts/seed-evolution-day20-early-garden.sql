-- Reconcile the isolated evolution world with the accelerated Day 16-20 plan.
-- The old Day 50 candidate remains available for comparing later content.
UPDATE world_entities
SET born_day = 16, sprite = 'map-tree map-fruit-tree',
  message = '枝に赤い実が見えます。近づいて採り、庭に植えられます。'
WHERE entity_key = 'source-fruit-tree';
