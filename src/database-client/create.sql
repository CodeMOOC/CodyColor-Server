-- Sample MySQL creation file

SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0;
SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0;
SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='TRADITIONAL,ALLOW_INVALID_DATES';

-- -----------------------------------------------------
-- Schema CodyColor
-- -----------------------------------------------------
CREATE SCHEMA IF NOT EXISTS `CodyColor` DEFAULT CHARACTER SET utf8;
USE `CodyColor`;

-- -----------------------------------------------------
-- Table `CodyColor`.`Sample`
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS `CodyColor`.`Sample` (
    `ID` INTEGER NOT NULL AUTO_INCREMENT,
    `Value` VARCHAR(256) NOT NULL,

    PRIMARY KEY (`ID`)
)
ENGINE = InnoDB;

SET SQL_MODE=@OLD_SQL_MODE;
SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS;
SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS;
