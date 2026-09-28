-- 追記型ログを世界の正とするための仕掛け。
--
-- これまで creation_events は「何かが起きた」ことしか書いておらず、世界の中身は
-- world_entities / world_tiles の現在値にしかなかった。行を直接書き換えると、
-- 前の姿はどこにも残らない。
--
-- 変更の経路（手のSQL、将来のAPI、AIの創造サイクル）に関わらずログが必ず残るよう、
-- 記録はトリガーで行う。書き換えた者がログを書き忘れることができなくなる。

-- 変更が属する世界日。存在の誕生日ではなく、それが起きた日を指す。
CREATE VIEW current_world_day AS SELECT COALESCE(MAX(world_day), 1) AS world_day FROM world_days;

CREATE TRIGGER world_entities_added AFTER INSERT ON world_entities
BEGIN
  INSERT INTO creation_events (world_day, kind, payload)
  VALUES (NEW.born_day, 'entity_added', json_object(
    'entity_key', NEW.entity_key, 'kind', NEW.kind,
    'x', NEW.x, 'y', NEW.y, 'width', NEW.width, 'height', NEW.height,
    'sprite', NEW.sprite, 'label', NEW.label, 'message', NEW.message,
    'panel', NEW.panel, 'flat', NEW.flat, 'blocks', NEW.blocks,
    'born_day', NEW.born_day));
END;

-- 訂正も消滅も上書きではなく追記として残す。前の姿と後の姿を両方書く。
CREATE TRIGGER world_entities_changed AFTER UPDATE ON world_entities
BEGIN
  INSERT INTO creation_events (world_day, kind, payload)
  VALUES ((SELECT world_day FROM current_world_day),
    CASE WHEN OLD.gone_day IS NULL AND NEW.gone_day IS NOT NULL THEN 'entity_gone' ELSE 'entity_changed' END,
    json_object(
      'entity_key', NEW.entity_key,
      'before', json_object('x', OLD.x, 'y', OLD.y, 'width', OLD.width, 'height', OLD.height,
        'sprite', OLD.sprite, 'label', OLD.label, 'message', OLD.message,
        'panel', OLD.panel, 'flat', OLD.flat, 'blocks', OLD.blocks, 'gone_day', OLD.gone_day),
      'after', json_object('x', NEW.x, 'y', NEW.y, 'width', NEW.width, 'height', NEW.height,
        'sprite', NEW.sprite, 'label', NEW.label, 'message', NEW.message,
        'panel', NEW.panel, 'flat', NEW.flat, 'blocks', NEW.blocks, 'gone_day', NEW.gone_day)));
END;

-- 行の削除は歴史を消すため、本来は gone_day を立てる。
-- それでも消された場合に、消えたという事実だけは残す。
CREATE TRIGGER world_entities_removed AFTER DELETE ON world_entities
BEGIN
  INSERT INTO creation_events (world_day, kind, payload)
  VALUES ((SELECT world_day FROM current_world_day), 'entity_deleted', json_object(
    'entity_key', OLD.entity_key, 'x', OLD.x, 'y', OLD.y,
    'sprite', OLD.sprite, 'label', OLD.label, 'born_day', OLD.born_day));
END;

CREATE TRIGGER world_tiles_added AFTER INSERT ON world_tiles
BEGIN
  INSERT INTO creation_events (world_day, kind, payload)
  VALUES (NEW.born_day, 'tile_added', json_object('x', NEW.x, 'y', NEW.y, 'kind', NEW.kind, 'born_day', NEW.born_day));
END;

CREATE TRIGGER world_tiles_changed AFTER UPDATE ON world_tiles
BEGIN
  INSERT INTO creation_events (world_day, kind, payload)
  VALUES ((SELECT world_day FROM current_world_day), 'tile_changed', json_object(
    'x', NEW.x, 'y', NEW.y,
    'before', json_object('kind', OLD.kind, 'gone_day', OLD.gone_day),
    'after', json_object('kind', NEW.kind, 'gone_day', NEW.gone_day)));
END;
